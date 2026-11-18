# price-agent

`price-agent` 是一套面向软件定制开发、算法授权、模型研发与技术方案咨询场景的开源 B2B 项目需求分析与智能报价系统。系统打通了从结构化需求录入、多格式附件解析、实时联网与公开市场研究、内部工作量与成本区间测算，到高密度报价单编排、多角色协同审核及正式 PDF / Excel 报价文件导出的完整业务闭环；同时支持在未配置 AI 服务时直接手动立项与创建报价单，开箱即用。

## 核心能力

- **动态模型列表与多档思考控制**：完整兼容 OpenAI Chat Completions 协议及 Vertex AI Gemini Proxy 扩展能力，支持动态拉取 `/v1/models` 模型列表与手动刷新缓存，在系统设置与项目分析界面可视化选择模型，并按模型代际动态联动 7 档思考强度（`AUTO` / `MINIMAL` / `LOW` / `MEDIUM` / `HIGH` / `XHIGH` / `NONE`）。
- **原生实时联网 Grounding 与网页上下文解析**：支持开启 Google Search 实时联网检索（Grounding）与 URL Context 网页及在线文档直读，自动沉淀检索词与高可信度公开来源引用；同时支持 Tavily、Serper、SearXNG 与公开搜索多路自动降级，以及多源参考汇率自动获取。
- **结构化需求立项与多格式文档智能切分**：覆盖算法授权、软件开发、模型开发、技术方案及自定义业务组合，支持上传并提取 PDF、DOCX、XLSX、CSV、TXT、MD 与图片资料（含文件魔数安全校验、中文多编码识别与长文档重点章节预算切分）。
- **双轨建单（AI 智能拆解 + 无 AI 手动建单）**：既可结合产品资产库与历史成交参考库进行 AI 工作量三档区间测算与风险缓冲评估，也可在未配置模型或快速报价场景下跳过 AI 分析，直接基于项目信息与团队默认费率生成结构化报价草稿。
- **高密度表格化报价编辑与分位精度测算**：采用高密度表格化报价明细编辑器，支持一键检索并带入“产品与成果库”及“历史价格参考库”条目，全链路采用 `Decimal.js` 精确重算未税报价、含税报价、税费另计与整单折扣金额。
- **标准商务版式 PDF 与 Excel 正式报价单导出**：支持中文、英文、中英双语三种语言模式；PDF 导出具备商务双列抬头、四列正式明细表（跨页自动重绘表头与防遮挡页脚）、条款区与甲乙方双栏签章框；Excel 导出采用跨平台中文字体并按中日韩全角字符宽度自适应计算行高。
- **多角色权限边界与操作审计**：内置管理员（`admin`）、审核人（`reviewer`）、售前（`presales`）、销售（`sales`）、研发（`engineer`）五类角色权限控制、乐观锁并发保护、历史报价版本快照归档与全量操作审计日志。

## 技术栈

- **运行环境**：Node.js >= 22，MySQL 8.4
- **后端服务**：Express 5，mysql2，Zod，decimal.js，helmet，express-rate-limit
- **文档解析与导出**：pdf-parse，mammoth，ExcelJS，PDFKit（内置思源黑体开源中文字库）
- **前端界面与构建**：React，esbuild（单壳层工作台与统一 CSS Design Tokens）
- **模型与检索接入**：兼容 Vertex AI Gemini Proxy 与标准 OpenAI `/v1` 接口协议（包括 DeepSeek、Qwen、本地 Ollama / vLLM 等）

## 环境变量说明

首次运行前，请将根目录下的 `.env.example` 复制为 `.env` 并按实际环境配置：

| 变量名 | 必填 | 默认值 / 示例 | 说明 |
| --- | --- | --- | --- |
| `HOST` | 否 | `127.0.0.1` | 服务监听地址（容器部署时设为 `0.0.0.0`） |
| `PORT` | 否 | `4312` | 服务监听端口 |
| `APP_BASE_PATH` | 否 | 空 | 反向代理子路径前缀（如 `/price-agent`，同时兼容根路径访问） |
| `APP_BRAND_NAME` | 否 | `报价工作台` | 工作台顶栏与登录页展示的系统品牌名称 |
| `DEFAULT_COMPANY_NAME` | 否 | 空 | 首次初始化数据库时自动写入系统设置的默认报价方名称 |
| `COOKIE_SECURE` | 否 | `auto` | 会话 Cookie 安全属性，可选 `auto`（按 HTTPS 协议自动识别）、`true`、`false` |
| `TRUST_PROXY` | 否 | `0` | 部署于反向代理后方时设为 `1` |
| `APP_SECRET` | 建议 | 随机长字符串 | 应用安全密钥配置项 |
| `PDF_FONT_PATH` | 否 | 内置字库路径 | 自定义 PDF 导出中文字体文件路径 |
| `DB_HOST` | 是 | `127.0.0.1` | MySQL 主机地址 |
| `DB_PORT` | 是 | `3397` | MySQL 端口（对应 `compose.yaml` 本地映射端口） |
| `DB_NAME` | 是 | `price_agent` | MySQL 数据库名称 |
| `DB_USER` | 是 | `price_agent` | MySQL 用户名 |
| `DB_PASSWORD` | 是 | 无 | MySQL 用户密码 |
| `DB_ROOT_PASSWORD` | 是 | 无 | MySQL Root 密码（供 Docker Compose 初始化数据库使用） |
| `VERTEX_BASE_URL` / `AI_BASE_URL` | 否 | 无 | 模型网关基础地址（兼容 `OPENAI_BASE_URL`；支持传入 `https://host` 或 `https://host/v1`；本地或内网地址支持免密钥调用；未配置时仍可使用手动建单功能） |
| `VERTEX_API_KEY` / `AI_API_KEY` | 否 | 无 | 模型服务 API 密钥（兼容 `OPENAI_API_KEY`） |
| `VERTEX_MODEL` / `AI_MODEL` | 否 | `gemini-3.8-flash` | 默认模型 ID（兼容 `OPENAI_MODEL`，可在页面动态切换 `/v1/models` 列表中的模型） |
| `VERTEX_THINKING_LEVEL` / `AI_THINKING_LEVEL` | 否 | `AUTO` | 默认思考强度，可选 `AUTO`、`MINIMAL`、`LOW`、`MEDIUM`、`HIGH`、`XHIGH`、`NONE` |
| `VERTEX_ENABLE_SEARCH` / `AI_ENABLE_SEARCH` | 否 | `true` | 是否默认开启原生 Google Search 实时联网 Grounding |
| `VERTEX_ENABLE_URL_CONTEXT` / `AI_ENABLE_URL_CONTEXT` | 否 | `true` | 是否默认开启原生 URL Context 网页与在线文档读取 |
| `AI_MAX_TOKENS` | 否 | 空 | 单次模型调用最大输出 Token 上限（留空由上游按模型规格自动分配） |
| `AI_TIMEOUT_MS` | 否 | `240000` | 模型请求超时时间（毫秒，范围 `5000` 至 `600000`） |
| `SEARCH_PROVIDER` | 否 | `auto` | 外部网页检索策略，可选 `auto`、`bing`、`tavily`、`serper`、`searxng`、`none` |
| `TAVILY_API_KEY` | 否 | 空 | 可选，配置后可用于外部网页搜索 |
| `SERPER_API_KEY` | 否 | 空 | 可选，配置后可用于 Google Serper 搜索 |
| `SEARXNG_BASE_URL` | 否 | 空 | 可选，自建开源 SearXNG 检索实例地址 |

## 快速开始

### 方式一：本地开发启动（Node.js + Docker MySQL）

1. 复制环境变量模板，按实际环境填写数据库密码与可选的模型服务参数：

```bash
cp .env.example .env
```

2. 启动本地 MySQL 8.4 数据库容器：

```bash
npm run db:start
```

3. 安装依赖并构建前端静态产物：

```bash
npm install
npm run build
```

4. 启动应用服务（开发调试可使用 `npm run dev`）：

```bash
npm start
```

服务启动时具备数据库连接自动退避重试与数据表无损初始化能力，并在开发环境检测到前端构建产物缺失时自动触发构建。浏览器访问 `http://127.0.0.1:4312`，首次进入按页面引导创建首个管理员账号，随后可在“系统设置”中配置报价方主体信息、默认角色人日成本、默认推理模型、思考强度与联网开关。

### 方式二：Docker Compose 生产部署

1. 复制并编辑 `.env` 文件，填写高强度的 `DB_PASSWORD`、`DB_ROOT_PASSWORD` 及模型网关配置：

```bash
cp .env.example .env
```

2. 按部署拓扑检查 `compose.production.yaml` 中的端口映射与 `APP_BASE_PATH`（默认映射至宿主机 `127.0.0.1:4322`），执行构建并后台启动：

```bash
docker compose -f compose.production.yaml up -d --build
```

多阶段镜像构建会自动完成前端编译与生产依赖精简，并通过内置健康检查守护应用与数据库容器运行状态。

## 目录结构

```text
price-agent/
├── client/                  # 前端工作台源码（统一单壳层布局、需求表单、分析调优、高密度报价编辑、资产库与设置）
├── designs/quote-input/     # 原始交互设计稿归档资源
├── server/                  # 后端服务源码（API 路由、认证与 RBAC、Vertex/OpenAI 模型接入、联网研究、PDF/Excel 导出）
├── compose.yaml             # 本地开发用 MySQL 8.4 容器编排配置
├── compose.production.yaml  # 生产环境应用与数据库容器编排配置
├── Dockerfile               # 多阶段生产镜像构建文件
└── .env.example             # 环境变量配置模板
```

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。内置字体等第三方开源资源遵循各自的许可协议（详见 `server/assets/OFL.txt` 与前端静态资源许可说明）。
