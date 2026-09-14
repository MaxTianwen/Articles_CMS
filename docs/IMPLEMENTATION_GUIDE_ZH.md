# WEB322 修复与 UI 改造：理解代码及面试准备

日期：2026-09-14。用户选择 Tabler 浅色后台、独立编辑页、默认表格/可切换卡片。改造由 Codex 协助完成，不能将这些改动描述成原始课程开发时已完成的成果。这里记录实际实现与验证，不代表用户已独立掌握。

## 第一步：核心修复与可测试结构

### 做了什么、为什么

原来的 index.js 同时配置服务、注册路由并启动监听，不便于隔离测试。现在 index.js 负责入口，app.js 的 createApp 接收数据库和图片服务，使测试能够替换外部服务。SQL 仍保留在 content-service.js，没有换框架或重写 React。

原来的 published 在 multipart 请求里是字符串，后端却与 boolean true 比较。现在 validation.js 明确接受 "true"/"false"，只转换一次。新增与编辑采用同一协议。

原来的编辑表单未传日期，但 UPDATE 覆盖日期；未选新图时还会发送 undefined 的字符串。现在 SQL 的 UPDATE 不改 articleDate，只有明确上传/移除图片才修改图片列。保留图片由后端决定，客户端不能用隐藏 URL 覆盖数据库图片。

原来的日期筛选有错误占位符 $[1]，分类又混用 JSON 与数据库。现在使用参数化 SQL 和数据库 JOIN，组合 search/category/status/minDate；无匹配结果是正常空列表，数据库失败走服务器错误。

新增字段、ID、分类存在性和真实日期校验。迁移增加 FK/CHECK，但不默默修改旧数据。SELECT 将 articleDate 转成 YYYY-MM-DD 文本，避免 DATE 转 JavaScript Date 后因时区显示成前一天。

### 主要源码

- app.js：请求参数与路由，调用服务，选择响应。
- content-service.js：getArticles/getArticle/addArticle/updateArticle/deleteArticle/getDashboard。
- lib/validation.js：parseId/parseFilters/validateArticle。
- migrations/001_admin_cms.sql：保留数据的结构迁移。
- tests/content.test.js：这些行为的回归测试。

### 解释练习

用文章 ID 12、新标题 "My revised post" 复述：浏览器发 PUT，FormData 在 request body；Express 从 params 读 12、Multer 从 body 解析字段，校验后数据服务用 SQL 参数执行 UPDATE。HTTP request 与 SQL query 是不同环节。只有数据库成功后才向浏览器返回成功。

英文技术表达：

> During this improvement phase, I used AI assistance to address problems in article updates. The revised code parses multipart boolean fields explicitly and preserves the stored image and article date unless a change is intended. Regression tests cover these behaviors.

## 第二步：管理员身份验证

### 做了什么、为什么

用户明确 CMS 仅供管理员使用，因此没有注册入口，也不增加读者账户或复杂角色表。admins 保存 username/password_hash/active，scrypt 用随机 salt 和较高计算成本处理密码。客户端 Cookie 只携带 Session ID，会话存 PostgreSQL，避免多实例环境依赖内存会话。

登录先验证 CSRF，再检查共享登录次数限制及密码。成功后 regenerate 会话，降低 session fixation 风险；登出 destroy。Cookie HttpOnly、SameSite=Lax，生产环境加 Secure。每次请求重新确认管理员仍 active；空闲两小时或登录满八小时后需要重新登录。

requireAdmin 同时保护 Home、文章页面、详情、编辑、JSON API 和写操作。网页未登录跳转 /login，API 返回 401。所有管理员可查看未发布内容，这与过去面向公众的 unpublished 访问规则不同。

### 主要源码

- lib/auth.js：hashPassword/verifyPassword/csrfToken/checkCsrf/createAuth。
- app.js：Session 配置、login/logout、requireAdmin。
- scripts/create-admin.js：本机隐藏输入密码并创建管理员，拒绝覆盖同名账户。
- tests/security.test.js：密码、共享限速、安全 Cookie、会话轮换和登出失效。

### 解释练习

Authentication 回答“你是谁”；Authorization 回答“你是否可以访问这个管理系统”。本项目角色简单，但仍须在服务端保护每条管理路径，不能只隐藏 Edit 按钮。

英文技术表达：

> The revised CMS is administrator-only. It verifies a username and a hashed password, then uses a server-side session for subsequent requests. Both HTML pages and article APIs check the administrator session.

## 第三步：图片和安全边界

上传前先确认管理员。Multer 限制文件大小、数量及字段数；sharp 验证图片可解码和真实格式，限制像素，转换为 WebP。上传大小上限为 4 MiB，为 Vercel 整个请求 4.5 MB 的限制留出正文和 multipart 开销。

Cloudinary 返回 secure_url 和 public_id。数据库保存失败时尝试回滚新上传；成功替换或删除时清理跟踪到的旧资产。历史图片只有 URL 而无 public_id 时保留，不从 URL 猜测后删除。远端清理失败会记录简短错误，仍可能需要人工核查。

服务配置从环境变量加载，远程数据库 TLS 验证证书。EJS 文本继续转义，预览使用 textContent，Helmet 设置安全响应头。参数化 SQL 与网页转义保护不同环节。

依赖审计发现旧版本 sharp 携带底层图片库漏洞，因此更新到修复版本。0 项已知依赖漏洞不是“系统绝对安全”的证明。

## 第四步：Tabler Home 与全站 UI

### 三种参考如何结合

- Tabler：统一实际使用的 CSS 组件、浅色视觉、侧栏、卡片、表格、输入框。
- Ghost：只借鉴专注文章的编辑工作流，没有安装 Ghost。
- Gallery：同一文章查询的另一种展示模板，没有第二套 CRUD。

### 页面及改动

| 页面 | 实现 | 为什么 |
| --- | --- | --- |
| Home | 真实计数、最近文章、未发布入口、分类计数 | 管理员登录后知道从哪里继续 |
| Articles | 合并查看与管理，搜索/筛选/排序/分页 | 避免在 Articles 与 Modify Article 之间来回跳转 |
| Gallery | 等宽卡片与缺图插画占位 | 通过封面与标题识别文章，切换仍保留筛选 |
| Editor | 左正文右设置、封面预览、未保存预览、错误保留输入 | 长文章比弹窗更容易编辑 |
| Article | 私有预览、正文换行、状态和编辑入口 | 检查真实保存后的内容 |
| Categories | 分类及文章数量，可进入筛选结果 | 让分类页承担实际导航用途 |
| Login/About/Error | 统一样式与清晰操作入口 | 完整覆盖用户到达的页面与失败状态 |

### 前后端分工

首次访问：SQL 数据 → Express res.render → EJS 生成 HTML → 浏览器显示。

点击 Preview：浏览器读取当前输入框，用 textContent 更新预览 DOM；不发 SQL，不运行 EJS，不保存文章。

点击 Save：浏览器收集 FormData → fetch → 后端验证与 SQL → 成功 JSON → 浏览器打开保存后的详情。失败时维持编辑内容并显示字段错误。文件输入框从不被写入已有图片 URL。

主要源码：views/admin/partials/start.ejs 和 end.ejs 是共同布局；home.ejs、articles.ejs、editor.ejs 是三个重点页面；public/css/admin.css 控制样式，public/js/admin.js 控制浏览器交互。旧 views 根目录文件保留为课程历史参考，运行时只查找 views/admin。

## 第五步：验收与事实边界

自动测试使用 PGlite 本地 PostgreSQL 引擎执行 SQL，Supertest 访问真实 Express 路由；图片解码是真实 sharp，Cloudinary 调用由测试适配器替代。

已覆盖的风险包括：布尔值转换、无新图保存、日期保留、日期时区、非法 ID、空白标题、无效分类、组合筛选、SQL 参数、数据库失败、管理员访问控制、CSRF、Cookie、Session ID 轮换、登出失效、图片格式/大小、上传后 SQL 失败补偿。

浏览器验证在 localhost 的隔离 demo 完成，demo 文章与账号是明确标注的样本。生产 Neon 迁移、真实管理员创建、真实 Cloudinary 上传和 Vercel 部署仍需配置环境后单独验收。没有性能基准，也没有生产可用性证明。

## 面试素材怎么使用

这次可以作为“近期改进课程项目”的事实素材，但不要说原始开发时就做过这些修复，也不要在不理解代码时说全部由自己独立完成。建议逐步亲自解释一个行为、指出对应代码、运行一次相关测试，再形成自己的回答。

日期偏移问题可用作真实候选事件：浏览器看到日期比样本晚/早一天 → 跟踪 PostgreSQL DATE 到 JavaScript Date → 改用日期文本 → 用回归测试固定日期。具体 STAR 的个人职责和行动仍要按用户真实参与情况填写，不能代填。

未来方向：MFA、密码恢复、细分权限、操作审计、可恢复删除、多人编辑冲突提示、富文本及其 HTML 清理。覆盖这些话题不等于已实现或掌握。

## UI 第二轮：根据反馈改善可读性与管理效率

- 问题：原先多个组件和手机断点使用 8–12px 字体。修改 public/css/admin.css 的字号层级，正文、导航、表单与按钮以 16px 为主，辅助文字至少 14px，编辑正文 18px；使用 rem 并加深灰色文字，而不是用浏览器缩放掩盖问题。
- 问题：顶部只显示当前位置，不能切换页面。修改 views/admin/partials/start.ejs，让顶部和侧栏共用 navigationItems，输出真实链接和 aria-current；编辑文章时仍高亮 Articles。没有增加路由或新的 JavaScript 导航状态。
- 问题：宣传语更像读者网站。Home 改成 Content overview、Content management、Recent articles、Unpublished articles；编辑页和登录页同步改用明确的任务名称。FOLIO 品牌统一大写，但文章正文不强制大写。
- 问题：字体放大后空间更紧张。简化侧栏说明区，为表格保留独立滚动容器，移动端重排列表信息，而不是重新缩小文字。筛选项和 Actions 列使用可见标签。
- 验证：新增顶部链接/高亮及管理文案测试，总计 26 项回归测试；浏览器检查桌面和手机布局。本轮不改数据库、登录逻辑或文章数据。

## UI 第三轮：用面包屑替代重复导航

应用名称已改为 CONTENT DESK，About 标签已简化。经用户确认，顶部不再重复 Home/Articles/Categories 菜单：左侧负责页面切换，顶部显示当前位置。公共 start.ejs 根据请求路径生成面包屑，例如 Home / Articles / Edit article；父级为真实链接，末项为带 aria-current 的文本。手机端保留侧栏按钮，面包屑可换行，不缩小字号。本次仅改模板、CSS 和回归测试，不更改路由或登录逻辑。
