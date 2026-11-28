import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple, type KnownProvider, type Model } from "@mariozechner/pi-ai";
import type { RoomDraft, RoomDraftInput, WallSide } from "../../src/room/core/model.ts";
import { env } from "../env.ts";
import type { RoomStudioRepository, StudioSnapshot } from "../db/repository.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { formatLayoutInspection } from "./replies.ts";
import { createRoomStudioTools, validateCommitRoomDraftGuard } from "./tools.ts";

export type AgentStreamEvent =
	| { type: "status"; phase: "thinking" | "tooling" | "answering"; message: string }
	| { type: "thinking_delta"; delta: string }
	| { type: "text_delta"; delta: string }
	| { type: "tool_start"; toolCallId: string; toolName: string; label: string; args?: Record<string, unknown> }
	| { type: "tool_end"; toolCallId: string; toolName: string; label: string; isError: boolean; durationMs: number; summary: string }
	| { type: "draft_updated"; draft: RoomDraft | null }
	| { type: "scene_sync"; snapshot: StudioSnapshot }
	| { type: "done"; reply: string }
	| { type: "error"; message: string };

function logAgent(tag: string, detail: string): void {
	const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
	console.log(`[${ts}] [PiAgent] [${tag}] ${detail}`);
}

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
	deepseek: "https://api.deepseek.com/v1",
	openai: "https://api.openai.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
	xai: "https://api.x.ai/v1",
	groq: "https://api.groq.com/openai/v1",
};

function resolveModel(): Model<any> {
	const provider = env.llmProvider as KnownProvider;
	const builtin = getModel(provider, env.llmModel as never);
	if (builtin) {
		return env.llmBaseUrl ? { ...builtin, baseUrl: env.llmBaseUrl } : builtin;
	}
	const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[env.llmProvider.toLowerCase()] || "https://api.openai.com/v1";
	// Support any custom OpenAI-compatible model ID (DeepSeek, SiliconFlow, Ollama, etc.)
	return {
		id: env.llmModel,
		name: env.llmModel,
		api: "openai-completions",
		provider: env.llmProvider || "openai",
		baseUrl: env.llmBaseUrl || defaultBaseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

/**
 * Local deterministic fallback runner when LLM_API_KEY is not configured yet.
 * Executes the EXACT same 9 PiAgent tools so the full Clarify-then-Act, SQLite,
 * semantic placement, and layout-variant workflows can be tested out of the box.
 */
async function runLocalDemoFallback(
	repo: RoomStudioRepository,
	sessionId: string,
	userMessage: string,
	emit: (event: AgentStreamEvent) => void,
	explicitConfirm: boolean,
): Promise<string> {
	const tools = createRoomStudioTools(repo, sessionId, {
		onDraftUpdated: (draft) => emit({ type: "draft_updated", draft }),
		onSceneSync: (snapshot) => emit({ type: "scene_sync", snapshot }),
	});
	const findTool = (name: string) => tools.find((t) => t.name === name)!;

	const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
		const tool = findTool(name);
		const callId = `local-${Date.now().toString(36)}`;
		const t0 = Date.now();
		logAgent("tool_start", `${name} args=${JSON.stringify(args)}`);
		emit({ type: "status", phase: "tooling", message: `正在执行：${tool.label}…` });
		emit({ type: "tool_start", toolCallId: callId, toolName: name, label: tool.label, args });
		try {
			if (name === "commit_room_draft") {
				const guard = validateCommitRoomDraftGuard(repo, sessionId, userMessage, explicitConfirm);
				if (guard.block) throw new Error(guard.reason);
			}
			const res = await tool.execute(callId, args, new AbortController().signal);
			const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			const durationMs = Date.now() - t0;
			logAgent("tool_end", `${name} ok (${durationMs}ms) ${text.slice(0, 120)}`);
			emit({ type: "tool_end", toolCallId: callId, toolName: name, label: tool.label, isError: false, durationMs, summary: text.slice(0, 160) });
			return text;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const durationMs = Date.now() - t0;
			logAgent("tool_end", `${name} ERROR (${durationMs}ms) ${msg}`);
			emit({ type: "tool_end", toolCallId: callId, toolName: name, label: tool.label, isError: true, durationMs, summary: msg });
			throw err;
		}
	};

	const session = repo.getOrCreateSession(sessionId);
	let reply = "";

	// 1. Confirm pending room draft
	if (session.draft && (explicitConfirm || /(确认|可以|好的|就按这个|创建吧|建吧)/.test(userMessage))) {
		const out = JSON.parse(await runTool("commit_room_draft", { populateStarterFurniture: true })) as {
			createdRoom: { name: string; width: number; depth: number };
			furnitureCount: number;
		};
		reply = `已为你正式创建新房间「${out.createdRoom.name}」（${(out.createdRoom.width / 100).toFixed(2)} × ${(out.createdRoom.depth / 100).toFixed(2)} m），并自动摆放了 ${out.furnitureCount} 件无冲突基础家具。原来的房间已完整保留，你可以在顶部随时切换。`;
	}
	// 2. Room creation / draft clarification
	else if (/(新建|创建|建一个|搞一个|加一个).*(房间|卧室|书房|客厅)/.test(userMessage) || (session.draft && /(米|宽|深|门|窗|卫生间)/.test(userMessage))) {
		const input: RoomDraftInput = {};
		const dimMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(?:米|m)?\s*[×xX*宽到和]\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/);
		if (dimMatch) {
			const w = Number(dimMatch[1]);
			const d = Number(dimMatch[2]);
			input.widthCm = w <= 20 ? Math.round(w * 100) : Math.round(w);
			input.depthCm = d <= 20 ? Math.round(d * 100) : Math.round(d);
		} else {
			const wMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\s*宽|宽\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/);
			const dMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\s*[深长]|[深长]\s*(\d+(?:\.\d+)?)\s*(?:米|m)?/);
			if (wMatch) {
				const v = Number(wMatch[1] ?? wMatch[2]);
				input.widthCm = v <= 20 ? Math.round(v * 100) : Math.round(v);
			}
			if (dMatch) {
				const v = Number(dMatch[1] ?? dMatch[2]);
				input.depthCm = v <= 20 ? Math.round(v * 100) : Math.round(v);
			}
		}
		if (/(书房)/.test(userMessage)) input.name = "独立书房";
		else if (/(次卧)/.test(userMessage)) input.name = "次卧";
		else if (/(主卧)/.test(userMessage)) input.name = "主卧";
		else if (!session.draft) input.name = "新建房间";

		const parseSide = (keyword: string): WallSide | undefined => {
			if (new RegExp(`${keyword}.*(左|西)|(左|西).*${keyword}`).test(userMessage)) return "west";
			if (new RegExp(`${keyword}.*(右|东)|(右|东).*${keyword}`).test(userMessage)) return "east";
			if (new RegExp(`${keyword}.*(上|北)|(上|北).*${keyword}`).test(userMessage)) return "north";
			if (new RegExp(`${keyword}.*(下|南)|(下|南).*${keyword}`).test(userMessage)) return "south";
			return undefined;
		};
		const dSide = parseSide("门");
		const wSide = parseSide("窗");
		if (dSide) input.doorSide = dSide;
		if (wSide) input.windowSide = wSide;
		if (/(不要|无|不带|没有).*(卫生间|卫浴)/.test(userMessage)) input.hasBathroom = false;
		else if (/(卫生间|卫浴)/.test(userMessage)) input.hasBathroom = true;

		const draftRes = JSON.parse(await runTool("update_room_draft", {
			...input,
			questionsForUser: ["请确认入户门和采光窗的朝向，以及是否需要独立卫生间；没问题的话点击卡片上的「确认创建」即可。"],
		})) as { missingFields: string[]; assumedFields: string[]; errors: string[] };

		const missing = draftRes.missingFields.length ? `\n- **待确认项**：${draftRes.missingFields.join("、")}` : "";
		const assumed = draftRes.assumedFields.length ? `\n- **暂定默认**：${draftRes.assumedFields.join("、")}` : "";
		const errs = draftRes.errors.length ? `\n- **几何提醒**：${draftRes.errors.join("；")}` : "";
		reply = `已为你更新**房间需求梳理草稿**，并在画布中生成了预览轮廓：${missing}${assumed}${errs}\n\n你可以继续补充修改，或直接回复「确认创建」/ 点击草稿卡片上的确认按钮正式生成房间。`;
	}
	// 3. One-click style layout + variant comparison
	else if (/(办公|观影|休闲|极简|温馨|自动布局|重新布置|方案)/.test(userMessage)) {
		if (/(对比|比较)/.test(userMessage)) {
			const snap = repo.getStudioSnapshot(sessionId);
			if (snap.variants.length < 2) {
				await runTool("manage_layout_variant", { action: "save", name: "方案A-当前" });
				await runTool("arrange_room_style", { style: "work_focus", saveAsVariantName: "方案B-办公优先" });
				const cmp = JSON.parse(await runTool("manage_layout_variant", {
					action: "compare", name: "方案A-当前", compareWith: "方案B-办公优先",
				})) as { summary: string };
				reply = `已为你保存「方案A-当前」，并生成了「方案B-办公优先」用于对比：\n\n${cmp.summary}\n\n你可以在右侧「方案快照」中一键来回切换查看 3D 效果！`;
			} else {
				const [a, b] = snap.variants.slice(-2);
				const cmp = JSON.parse(await runTool("manage_layout_variant", {
					action: "compare", name: a.name, compareWith: b.name,
				})) as { summary: string };
				reply = cmp.summary;
			}
		} else {
			const style = /(办公)/.test(userMessage)
				? "work_focus"
				: /(观影|休闲|追剧)/.test(userMessage)
					? "relax_cinema"
					: /(极简|宽敞|留白)/.test(userMessage)
						? "minimal_spacious"
						: "cozy_bedroom";
			const styleLabel = {
				work_focus: "居家办公优先",
				relax_cinema: "休闲观影",
				minimal_spacious: "极简宽敞",
				cozy_bedroom: "温馨卧室",
			}[style];
			await runTool("arrange_room_style", { style, saveAsVariantName: styleLabel });
			reply = `已按「${styleLabel}」重新自动排布当前房间，并自动保存为同名方案快照（可在右侧方案栏随时切换对比）。`;
		}
	}
	// 4. Semantic furniture placement
	else if (/(移|挪|放|摆|加)/.test(userMessage) && /(书桌|床|沙发|座椅|椅子|矮柜|绿植|落地灯|地毯)/.test(userMessage)) {
		const kindMap: Array<[RegExp, string]> = [
			[/书桌/, "desk"], [/双人床|床/, "bed"], [/沙发/, "sofa"], [/座椅|椅子/, "chair"],
			[/矮柜|柜/, "cabinet"], [/绿植|植物/, "plant"], [/落地灯|灯/, "lamp"], [/地毯/, "rug"],
		];
		const kind = kindMap.find(([re]) => re.test(userMessage))?.[1] ?? "desk";
		const snap = repo.getStudioSnapshot(sessionId);
		const existing = /(移|挪)/.test(userMessage) ? snap.activeRoom.items.find((it) => it.kind === kind) : undefined;
		const anchor = /(窗)/.test(userMessage)
			? "under_window"
			: /(北|上)/.test(userMessage)
				? "north_wall"
				: /(南|下)/.test(userMessage)
					? "south_wall"
					: /(东|右)/.test(userMessage)
						? "east_wall"
						: /(西|左)/.test(userMessage)
							? "west_wall"
							: "center";
		const out = JSON.parse(await runTool("place_or_move_furniture", {
			...(existing ? { itemId: existing.id } : { kind }),
			anchor,
		})) as { detail: string };
		reply = out.detail;
	}
	// 5. Conflict inspection
	else if (/(冲突|问题|检查|诊断|挡门)/.test(userMessage)) {
		reply = formatLayoutInspection(JSON.parse(await runTool("inspect_layout_conflicts", {})));
	} else {
		reply = `你好！我是 Room Studio 空间助手（当前为本地演示模式，在根目录 \`.env\` 中配置 \`LLM_API_KEY\` 后将自动启用 PiAgent 完整大模型推理）。\n\n你可以试试对我说：\n- 「帮我新建一个 5 米宽、4 米深、带卫生间的卧室」\n- 「把书桌挪到窗户下面」\n- 「按居家办公优先重新布置并和当前方案对比」\n- 「检查一下当前布局有没有冲突」`;
	}

	emit({ type: "text_delta", delta: reply });
	return reply;
}

export async function runPiAgentChat(options: {
	repo: RoomStudioRepository;
	sessionId: string;
	userMessage: string;
	explicitConfirm?: boolean;
	emit: (event: AgentStreamEvent) => void;
	signal?: AbortSignal;
}): Promise<void> {
	const { repo, sessionId, userMessage, explicitConfirm = false, emit, signal } = options;
	const session = repo.getOrCreateSession(sessionId);
	const startedAt = Date.now();
	logAgent("chat_start", `session=${sessionId} room=${session.activeRoomId} prompt=${JSON.stringify(userMessage)}`);
	emit({ type: "status", phase: "thinking", message: "正在连接模型并分析需求…" });

	try {
		let finalReply = "";

		if (!env.llmApiKey) {
			logAgent("mode", "本地规则演示模式（未配置 LLM_API_KEY）");
			finalReply = await runLocalDemoFallback(repo, sessionId, userMessage, emit, explicitConfirm);
		} else {
			const snapshot = repo.getStudioSnapshot(sessionId);
			const tools = createRoomStudioTools(repo, sessionId, {
				onDraftUpdated: (draft) => {
					logAgent("draft_updated", draft ? `valid=${draft.valid} missing=[${draft.missingFields.join(",")}]` : "cleared");
					emit({ type: "draft_updated", draft });
				},
				onSceneSync: (snap) => {
					logAgent("scene_sync", `activeRoom=${snap.activeRoom.id} items=${snap.activeRoom.items.length} variants=${snap.variants.length}`);
					emit({ type: "scene_sync", snapshot: snap });
				},
			});
			const toolLabels = new Map(tools.map((t) => [t.name, t.label]));
			const toolTimers = new Map<string, number>();
			const model = resolveModel();
			logAgent("model", `${model.provider}/${model.id} -> ${model.baseUrl}`);

			const initialMessages: AgentMessage[] = session.messages.map((m) =>
				m.role === "user"
					? { role: "user", content: m.text, timestamp: m.timestamp }
					: {
						role: "assistant",
						content: [{ type: "text", text: m.text }],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
						stopReason: "stop",
						timestamp: m.timestamp,
					},
			);

			const agent = new Agent({
				initialState: {
					systemPrompt: buildSystemPrompt(snapshot),
					model,
					tools,
					messages: initialMessages,
				},
				streamFn: streamSimple,
				toolExecution: "sequential",
				getApiKey: () => env.llmApiKey,
				beforeToolCall: async ({ toolCall }) => {
					if (toolCall.name === "commit_room_draft") {
						const guard = validateCommitRoomDraftGuard(repo, sessionId, userMessage, explicitConfirm);
						if (guard.block) {
							logAgent("guard_block", `blocked commit_room_draft: ${guard.reason}`);
							return { block: true, reason: guard.reason };
						}
					}
					return undefined;
				},
			});

			let thinkingChars = 0;
			let turnCount = 0;
			const unsubscribe = agent.subscribe((event: AgentEvent) => {
				if (event.type === "turn_start") {
					turnCount++;
					logAgent("turn_start", `turn=#${turnCount}`);
					emit({ type: "status", phase: "thinking", message: turnCount === 1 ? "正在思考…" : "正在根据工具结果整理回复…" });
				} else if (event.type === "message_update") {
					const ae = event.assistantMessageEvent;
					if (ae.type === "thinking_start") {
						emit({ type: "status", phase: "thinking", message: "正在深度思考…" });
					} else if (ae.type === "thinking_delta") {
						thinkingChars += ae.delta.length;
						emit({ type: "thinking_delta", delta: ae.delta });
					} else if (ae.type === "thinking_end") {
						logAgent("thinking_end", `chars=${thinkingChars}`);
					} else if (ae.type === "text_start") {
						emit({ type: "status", phase: "answering", message: "正在生成回复…" });
					} else if (ae.type === "text_delta") {
						finalReply += ae.delta;
						emit({ type: "text_delta", delta: ae.delta });
					}
				} else if (event.type === "tool_execution_start") {
					const label = toolLabels.get(event.toolName) ?? event.toolName;
					const args = (event.args && typeof event.args === "object") ? event.args as Record<string, unknown> : undefined;
					toolTimers.set(event.toolCallId, Date.now());
					logAgent("tool_start", `${event.toolName} args=${JSON.stringify(args ?? {})}`);
					emit({ type: "status", phase: "tooling", message: `正在执行：${label}…` });
					emit({
						type: "tool_start",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						label,
						args,
					});
				} else if (event.type === "tool_execution_end") {
					const label = toolLabels.get(event.toolName) ?? event.toolName;
					const durationMs = Date.now() - (toolTimers.get(event.toolCallId) ?? Date.now());
					toolTimers.delete(event.toolCallId);
					const rawText = Array.isArray(event.result?.content)
						? event.result.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("")
						: "";
					logAgent("tool_end", `${event.toolName} ${event.isError ? "ERROR" : "ok"} (${durationMs}ms) ${rawText.slice(0, 140)}`);
					emit({
						type: "tool_end",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						label,
						isError: event.isError,
						durationMs,
						summary: rawText.slice(0, 200),
					});
				}
			});

			if (signal) {
				signal.addEventListener("abort", () => {
					logAgent("abort", `session=${sessionId}`);
					agent.abort();
				}, { once: true });
			}

			try {
				await agent.prompt(userMessage);
			} finally {
				unsubscribe();
			}

			if (agent.state.errorMessage && !finalReply) {
				throw new Error(agent.state.errorMessage);
			}
		}

		const now = Date.now();
		repo.saveSessionMessages(sessionId, [
			...session.messages,
			{ role: "user", text: userMessage, timestamp: now - 1 },
			{ role: "assistant", text: finalReply, timestamp: now },
		]);
		logAgent("chat_done", `total=${now - startedAt}ms replyLen=${finalReply.length}`);
		emit({ type: "done", reply: finalReply });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logAgent("chat_error", `total=${Date.now() - startedAt}ms error=${message}`);
		emit({ type: "error", message });
	}
}
