<script lang="ts">
import { onMount } from "svelte";

import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";
import { getPostUrlBySlug, url } from "../utils/url-utils";

export let sortedPosts: Post[] = [];

const params = new URLSearchParams(window.location.search);
const tags = params.getAll("tag");
const categories = params.getAll("category");
const uncategorized = params.get("uncategorized");

interface Post {
	slug: string;
	data: {
		title: string;
		tags: string[];
		category?: string | null;
		published: Date;
	};
}

interface Group {
	year: number;
	posts: Post[];
}

let groups: Group[] = [];

function formatDate(date: Date) {
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day}`;
}

onMount(async () => {
	let filteredPosts: Post[] = sortedPosts;

	if (tags.length > 0) {
		filteredPosts = filteredPosts.filter(
			(post) =>
				Array.isArray(post.data.tags) &&
				post.data.tags.some((tag) => tags.includes(tag)),
		);
	}

	if (categories.length > 0) {
		filteredPosts = filteredPosts.filter(
			(post) => post.data.category && categories.includes(post.data.category),
		);
	}

	if (uncategorized) {
		filteredPosts = filteredPosts.filter((post) => !post.data.category);
	}

	const grouped = filteredPosts.reduce(
		(acc, post) => {
			const year = post.data.published.getFullYear();
			if (!acc[year]) {
				acc[year] = [];
			}
			acc[year].push(post);
			return acc;
		},
		{} as Record<number, Post[]>,
	);

	const groupedPostsArray = Object.keys(grouped).map((yearStr) => ({
		year: Number.parseInt(yearStr, 10),
		posts: grouped[Number.parseInt(yearStr, 10)],
	}));

	groupedPostsArray.sort((a, b) => b.year - a.year);

	groups = groupedPostsArray;
});
</script>

<div class="archive-list">
	{#if tags.length || categories.length || uncategorized}
		<p class="archive-filter sport-meta">
			<span>筛选：{[...categories, ...tags.map((tag) => `#${tag}`), ...(uncategorized ? [i18n(I18nKey.uncategorized)] : [])].join(" / ")}</span>
			<a href={url("/archive/")}>清除筛选</a>
		</p>
	{/if}
	{#each groups as { year, posts }}
		<section>
			<header>
				<h2>{year}</h2>
				<span class="sport-meta">{posts.length} {i18n(posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}</span>
			</header>
			<ul>
				{#each posts as { slug, data }}
					<li>
						<a href={getPostUrlBySlug(slug)}>
							<span class="sport-meta">{formatDate(data.published)}</span>
							<strong>{data.title}</strong>
							<span class="sport-meta tags">{data.tags.map((tag) => `#${tag}`).join(" ")}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="sport-meta">没有符合条件的文章。</p>
	{/each}
</div>

<style>
	.archive-list {
		padding-block: 1.2rem;
	}
	header,
	li a,
	.archive-filter {
		display: flex;
		align-items: baseline;
		gap: .65rem 1rem;
	}
	header {
		padding-block: .75rem .5rem;
	}
	h2 {
		color: var(--sport-accent);
		font: italic 900 2.5rem / 1 var(--sport-display);
	}
	li a {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr) minmax(0, 16rem);
		padding-block: .9rem;
		border-top: 1px solid var(--sport-line);
	}
	li a:hover {
		color: var(--sport-accent);
	}
	.archive-filter {
		flex-wrap: wrap;
		overflow-wrap: anywhere;
	}
	.archive-filter a {
		color: var(--sport-accent);
		text-decoration: underline;
		text-underline-offset: .2em;
	}
	.tags {
		text-align: end;
		overflow-wrap: anywhere;
	}
	@media (max-width: 40rem) {
		li a { grid-template-columns: 3rem minmax(0, 1fr); }
		.tags { grid-column: 2; text-align: start; }
	}
</style>
