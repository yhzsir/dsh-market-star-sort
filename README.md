# Discover tab star sort · 发现页 Star 排序

`dsh-market-star-sort` —— 给 DSH Web「插件 → 发现」页的**排序**菜单增加一项 **Star 数**（按 GitHub Star 数降序）。Host-only，无客户端代码。

A Host-only plugin for DSH Web: the Discover tab builds its sort menu from the sort keys the selected plugin market index declares, and the stock index declares none. This plugin declares one extra `stars` key and fills each entry's value from the index site's public catalog — so the key shows up natively in the sort menu while the Host keeps doing the ordering and paging. The page itself is not patched.

## 安装

在 Web 界面「插件」页的安装入口粘贴以下任一，然后在「插件」页刷新（或重启 DSH）：

- 预构建压缩包：`https://github.com/yhzsir/dsh-market-star-sort/releases/latest/download/dsh-market-star-sort.tgz`
- 仓库地址：`https://github.com/yhzsir/dsh-market-star-sort`
- 包名（npm 发布后）：`dsh-market-star-sort`

## 为什么需要这个插件

「发现」页的排序菜单不是写死的：它由**插件索引声明的排序键**（`metadata.sortKeys`）生成，Host 再按每个条目的 `metadata.sortKeys.<id>` 数值排序、分页。

当前配置的索引源 `https://awesome-dsh-plugin.com/index.json` 声明了 `sortKeys: {}`（分类之外没有任何排序键），所以页面上只有「默认顺序 / 发布时间 / 最佳搜索」三种。

这个插件的 Host 半部在索引 JSON **被 Host 解析之前**做一次纯增量补全：

1. 给索引头部加一条排序键声明：`metadata.sortKeys.stars = { title: { en: "Stars", zh: "Star 数" }, order: "desc" }`；
2. 给每个索引条目补上 `metadata.sortKeys.stars = <GitHub Star 数>`。

补全后的文档仍然满足格式 1 校验，页面因此**原生**多出「Star 数」这一项，排序、翻页、再次进入都由 Host 自己完成，客户端的发现页代码一行未改。没有 Star 数据的条目按索引既有的规则排在最后。

## Star 数据从哪来

- 随包种子：`data/stars.json`（按下拉时间抓取的快照，覆盖索引里全部条目）；
- 后台刷新：启动后按需下载 `catalogUrl`（默认 `https://awesome-dsh-plugin.com/catalog.json`，`items[].slug` + `items[].stars`），成功后写入 `<profile>/.market-star-sort/stars.json`，下次启动直接读缓存；
- 刷新间隔：`refreshHours`（默认 24 小时）。刷新失败时继续用已有快照。

索引条目与 Star 数据的对应关系依次尝试：条目标题 `owner/repo` → 仓库 URL 的 `github.com/<owner>/<repo>` → 索引站的条目页 `/p/<owner>/<repo>/`。

## 配置（均可选）

写在 `cordis.patch.yml` 中该行的 `config` 下：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `catalogUrl` | `https://awesome-dsh-plugin.com/catalog.json` | Star 数据来源 |
| `refreshHours` | `24` | 重新下载 Star 数据的间隔 |
| `fetchTimeoutMs` | `180000` | 单次下载时限（站点较慢时保留足够余量） |
| `indexUrls` | `[]`（另含两个内置的 awesome-dsh-plugin 索引地址） | 额外需要补全的索引 URL |

```yaml
- insert:
    - id: market-star-sort
      name: dsh-market-star-sort
      config:
        refreshHours: 12
```

## 行为边界

- 只改写**能识别为格式 1 插件市场索引**、且条目与 Star 快照匹配过半的响应；其他 fetch 原样返回，解析失败也原样返回（用 `Response.clone()` 兜底）。
- 只在索引真的从网络上取回时补全；Host 的索引缓存（默认 10 分钟）和页面刷新、搜索、翻页都走同一条路径。
- 索引日后若自己声明了 `stars` 排序键，插件不会覆盖它。
- 卡片列表本身不显示 Star 数字（发现页的卡片布局由内置客户端渲染，插件没有可插入的位置）；本插件只负责排序。
- 插件只下载上述 catalog 与索引文档，不会把本机任何信息发出去。

## 文件

- `index.js` — Host 插件：种子/缓存读取、后台刷新、索引响应补全
- `data/stars.json` — Star 快照（`{ updated, source, stars: { "owner/repo": n } }`）
- `cordis.patch.yml` — Loader 行
- `locale/{en,zh}.json`、`icon.svg` — 插件页显示用的元数据与图标

## License

MIT © yhzsir