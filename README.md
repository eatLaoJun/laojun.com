# LaoJun 的个人博客

用 Astro 搭建的个人站，写技术笔记，也记下一些生活里的想法。这个仓库从 Fuwari 改起，文章用 Markdown 管理，构建后是静态网站，不需要数据库或后台管理。

![LaoJun 博客的 WebGL 流体首页](src/content/posts/webgl-fluid/homepage.webp)

## 站点内容

- `/`：WebGL 流体首页。电脑上按住鼠标左键拖动，手机上按住并滑动，就能和光影互动。
- `/blog/`：运动杂志风格的文章列表。右上角可切换浅色和深色，浏览器会记住选择。
- `/archive/`：按年份查看文章，也可以通过文章上的分类和标签筛选。
- `/about/`：个人介绍和建站初衷。

目前收录了 [WebGL 流体教程](src/content/posts/webgl-fluid.md) 和 [《我为什么越来越喜欢 C 罗》](src/content/posts/ronaldo.md)。后续想在这个站里记录 Agent 实验和空间设计方面的尝试。

## 本地启动

建议使用 Node.js 22，项目锁定的包管理器版本为 pnpm 9.14.4。

```sh
git clone https://github.com/eatLaoJun/laojun.com.git
cd laojun.com
pnpm install --frozen-lockfile
pnpm dev
```

打开 [首页](http://localhost:4321/) 或直接进入 [博客列表](http://localhost:4321/blog/)。如果 Windows PowerShell 拦截了 `pnpm.ps1`，把命令里的 `pnpm` 换成 `pnpm.cmd`。

## 发布文章

在仓库根目录运行 `pnpm new-post my-first-post`，然后编辑生成的 `src/content/posts/my-first-post.md`。也可以直接在 [文章目录](src/content/posts/) 新建 Markdown 文件：

```markdown
---
title: "我的第一篇技术笔记"
published: 2026-11-22
description: "在这里写文章摘要。"
draft: false
---

从这里开始写正文。
```

- `title` 和 `published` 是必填字段。正文图片可放在文章旁边，用相对路径引用。
- `image` 设置封面；想让封面只出现在列表、不出现在正文顶部，可加 `showCover: false`。
- `tags` 和 `category` 可以手填。留空时，站点会按标题和摘要里的关键词推断；分类没匹配时使用「技术笔记」。
- `draft: true` 的文章仅在开发模式可见，不会进入正式构建。

## 常改的位置

| 想改什么 | 在哪里改 |
| --- | --- |
| 站名、导航、头像 | [`src/config.ts`](src/config.ts) |
| 关于页正文 | [`src/content/spec/about.md`](src/content/spec/about.md) |
| 博客配色和共用样式 | [`src/styles/sport.css`](src/styles/sport.css) |
| 流体首页的内容和布局 | [`src/pages/index.astro`](src/pages/index.astro) |
| 自动分类与标签规则 | [`src/utils/post-taxonomy.ts`](src/utils/post-taxonomy.ts) |

## 构建与部署

```sh
pnpm check
pnpm build
pnpm preview
```

`pnpm build` 会生成 `dist/` 和 Pagefind 搜索索引。想测试真实搜索结果，请在构建后用 `pnpm preview`，开发模式使用的是示例结果。

部署时把 [`astro.config.mjs`](astro.config.mjs) 的 `site` 改成自己的正式域名，再将 `dist/` 发布到静态托管平台。

## 致谢与许可

- 博客基于 [Fuwari](https://github.com/saicaca/fuwari) 和 [Astro](https://astro.build)，首页使用 Pavel Dobryakov 的 [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)。
- 代码使用 [MIT 许可证](LICENSE)。本站原创文章按 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 授权；第三方图片不在此授权范围内。
