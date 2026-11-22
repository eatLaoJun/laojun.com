const topics = [
	{
		category: "空间设计",
		tags: [
			["室内设计", /室内设计|空间设计|户型|房间布局/],
			["3D", /\b(?:3d|three\.js)\b/i],
		],
	},
	{
		category: "Agent 实验",
		tags: [
			["Agent", /\bagents?\b|智能体/i],
			["工具调用", /工具调用|\b(?:tool|function)[ -]calling\b/i],
		],
	},
	{
		category: "前端实验",
		tags: [
			["Astro", /\bastro\b/i],
			["WebGL", /\bwebgl\b/i],
			["TypeScript", /\btypescript\b/i],
			["React", /\breact\b/i],
			["前端", /前端|流体特效/],
		],
	},
] as const;

interface PostTaxonomy {
	title: string;
	description: string;
	tags: string[];
	category: string | null;
}

export function resolvePostTaxonomy(post: PostTaxonomy) {
	const summary = `${post.title}\n${post.description}`;
	const matches = topics.map(({ category, tags }) => ({
		category,
		tags: tags.filter(([, pattern]) => pattern.test(summary)).map(([name]) => name),
	}));
	const manualTags = post.tags.map((tag) => tag.trim()).filter(Boolean);
	const tags = manualTags.length ? manualTags : matches.flatMap((topic) => topic.tags);
	const category = post.category === null
		? null
		: post.category.trim() || matches.find((topic) => topic.tags.length)?.category || "技术笔记";

	return { category, tags: [...new Set(tags)] };
}
