import { type CollectionEntry, getCollection } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl } from "@utils/url-utils.ts";
import { resolvePostTaxonomy } from "./post-taxonomy";

async function getVisiblePosts() {
	const entries = await getCollection("posts", ({ data }) =>
		import.meta.env.DEV || !data.draft,
	);
	return entries.map((post) => ({
		...post,
		data: { ...post.data, ...resolvePostTaxonomy(post.data) },
	}));
}

async function getRawSortedPosts() {
	const posts = await getVisiblePosts();
	return posts.sort((a, b) => b.data.published.getTime() - a.data.published.getTime());
}

export async function getSortedPosts() {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].slug;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].slug;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}
export type PostForList = {
	slug: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		slug: post.slug,
		data: post.data,
	}));

	return sortedPostsList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const counts = new Map<string, number>();
	for (const { data } of await getVisiblePosts()) {
		for (const tag of data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return Array.from(counts, ([name, count]) => ({ name, count }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const counts = new Map<string | null, number>();
	for (const { data: { category } } of await getVisiblePosts()) {
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return Array.from(counts, ([category, count]) => ({
		name: category ?? i18n(I18nKey.uncategorized),
		count,
		url: getCategoryUrl(category),
	})).sort((a, b) => a.name.localeCompare(b.name));
}
