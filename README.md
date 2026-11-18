# price-agent

`price-agent` 是一套面向软件定制开发、算法授权、模型研发与技术方案咨询场景的开源 B2B 项目需求分析与智能报价系统。系统打通了从结构化需求录入、多格式附件解析、公开市场与客户信息检索、内部工作量与成本区间测算，到对外报价单编排、审批流转及 PDF / Excel 正式报价文件导出的完整业务闭环。

## 核心能力

- **结构化需求立项与附件解析**：覆盖算法授权、软件开发、模型开发、技术方案及自定义业务类型，支持上传并提取 PDF、DOCX、XLSX、CSV、TXT、MD 与常见图片格式的需求资料。
- **公开来源研究与汇率参考**：支持按需检索客户公开背景、行业中标或标价信息，并自动获取多币种参考汇率，所有外部事实均保留来源关联与可追溯标记。
- **工作量拆解与成本毛利测算**：结合团队已有产品资产库与历史成交参考库，区分已有成果复用与本次新增交付成本，按低、基准、高三档区间与风险预留、目标毛利率自动测算服务建议价与授权费用。
- **多版本报价与协同审核**：内置管理员、审核人、售前、销售、研发五类角色权限与状态流转机制，自动归档每次修改的历史快照并记录操作审计日志，成交记录可沉淀回历史价格参考库。
- **多语言正式报价单导出**：支持中文、英文、中英双语三种语言模式及多币种税费口径计算，可导出排版规范的 PDF 与 Excel 报价单。

## 技术栈

- **运行环境**：Node.js >= 22，MySQL 8.4
- **后端服务**：Express 5，mysql2，Zod，decimal.js，helmet，express-rate-limit
- **文档解析与导出**：pdf-parse，mammoth，ExcelJS，PDFKit
- **前端构建**：React，esbuild
- **模型与检索接入**：兼容 OpenAI Chat Completions 协议的模型接口；支持公开搜索或接入 Tavily / Serper 检索接口

## 环境变量说明

首次运行前，请将根目录下的 `.env.example` 复制为 `.env` 并按实际环境填写：

| 变量名 | 必填 | 默认值 / 示例 | 说明 |
| --- | --- | --- | --- |
| `HOST` | 否 | `127.0.0.1` | 服务监听地址（容器部署时设为 `0.0.0.0`） |
| `PORT` | 否 | `4312` | 服务监听端口 |
| `APP_BASE_PATH` | 否 | 空 | 反向代理子路径前缀（如 `/price-agent`，根路径部署留空） |
| `COOKIE_SECURE` | 否 | `false` | 启用 HTTPS 部署时建议设为 `true` |
| `TRUST_PROXY` | 否 | `0` | 位于反向代理后方时设为 `1` |
| `APP_SECRET` | 建议 | 随机长字符串 | 应用密钥配置项 |
| `DB_HOST` | 是 | `127.0.0.1` | MySQL 主机地址 |
| `DB_PORT` | 是 | `3397` | MySQL 端口（对应 `compose.yaml` 本地映射端口） |
| `DB_NAME` | 是 | `price_agent` | MySQL 数据库名称 |
| `DB_USER` | 是 | `price_agent` | MySQL 用户名 |
| `DB_PASSWORD` | 是 | 无 | MySQL 用户密码 |
| `DB_ROOT_PASSWORD` | 是 | 无 | MySQL Root 密码（供 Docker Compose 初始化数据库使用） |
| `VERTEX_BASE_URL` | 否 | 无 | 兼容 OpenAI 协议的模型服务地址（不含 `/chat/completions` 后缀）；未配置时仍可使用基础立项与手工报价管理，启动 AI 分析前需完成配置 |
| `VERTEX_API_KEY` | 否 | 无 | 模型服务 API 密钥 |
| `VERTEX_MODEL` | 否 | `gemini-2.5-flash` | 调用的模型名称 |
| `SEARCH_PROVIDER` | 否 | `bing` | 默认公开检索方式标识 |
| `TAVILY_API_KEY` | 否 | 空 | 可选，配置后优先使用 Tavily 搜索接口 |
| `SERPER_API_KEY` | 否 | 空 | 可选，未配置 Tavily 时使用 Serper 搜索接口 |

## 快速开始

### 方式一：本地开发启动（Node.js + Docker MySQL）

1. 准备环境变量文件，并修改其中的数据库密码与模型密钥：

```bash
cp .env.example .env
```

2. 启动本地 MySQL 8.4 数据库容器：

```bash
npm run db:start
```

3. 安装依赖并构建前端资源：

```bash
npm install
npm run build
```

4. 启动服务（开发热重载可使用 `npm run dev`）：

```bash
npm start
```

服务启动后会自动初始化数据表结构。浏览器访问 `http://127.0.0.1:4312`，首次进入时按页面引导创建首个管理员账号即可开始使用，并可在“系统设置”中配置报价主体信息、角色人日成本与团队成员。

### 方式二：Docker Compose 生产部署

1. 复制并配置 `.env` 文件（确保已填写高强度的 `DB_PASSWORD`、`DB_ROOT_PASSWORD` 以及模型接口参数）：

```bash
cp .env.example .env
```

2. 按需检查 `compose.production.yaml` 中的端口映射、`APP_BASE_PATH` 与 `COOKIE_SECURE` 配置（若本地或非 HTTPS 环境直连测试，可将 `COOKIE_SECURE` 调整为 `"false"` 并将 `APP_BASE_PATH` 设为空），随后构建并启动完整服务栈：

```bash
docker compose -f compose.production.yaml up -d --build
```

镜像构建阶段会自动执行前端编译与生产依赖精简，容器默认将服务映射至宿主机 `127.0.0.1:4322`。

## 目录结构

```text
price-agent/
├── client/                  # 前端工作台源码（项目管理、分析调整、报价编排、资产与设置）
├── designs/quote-input/     # 结构化需求表单组件、字段定义与静态资源
├── server/                  # 后端服务源码（API 路由、认证权限、AI 分析、联网检索、PDF/Excel 导出）
├── compose.yaml             # 本地开发用 MySQL 容器编排配置
├── compose.production.yaml  # 生产环境应用与数据库容器编排配置
├── Dockerfile               # 多阶段生产镜像构建文件
└── .env.example             # 环境变量配置模板
```

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。部分内置字体资源遵循各自的开源字库授权协议（详见 `server/assets/OFL.txt`）。
