import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });

markdown.renderer.rules.table_open = () =>
	'<div class="msg-table-scroll" role="region" aria-label="表格" tabindex="0"><table>\n';
markdown.renderer.rules.table_close = () => "</table></div>\n";

function normalizeListMarkers(text: string): string {
	let fence: string | undefined;
	return text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
				fence = undefined;
			}
			return line;
		}
		if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
			fence = marker[1];
			return line;
		}
		return line
			.replace(/^( {0,3})[•●▪][ \t]*(?=\S)/, "$1- ")
			.replace(/^( {0,3})([0-9]{1,3})[、．）][ \t]*(?=\S)/, "$1$2. ");
	}).join("\n");
}

export function renderChatMarkdown(text: string): string {
	return markdown.render(normalizeListMarkers(text));
}
