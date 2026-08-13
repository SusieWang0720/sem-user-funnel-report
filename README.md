# SEM User Funnel Report

将神策或广告平台导出的注册、试用、测试、付费四张 SEM 用户明细表，以及可选的创建明细表，合并清洗为按 Google / Bing 分渠道展示的用户漏斗 Excel 报表。

适合需要按 UIN 去重、统一漏斗口径、拆分广告系列内容并修复常见 UTM 脏数据的市场、投放和数据分析人员。工具只负责本地清洗和生成明细报表，不替代神策、Impala、广告平台或正式 BI 看板。

## 网页界面（推荐）

`web/` 提供一个可部署到 Vercel 的前端工具。Excel 解析、去重、补数和导出全部在浏览器本地完成，文件不会上传到服务器，也不调用大模型。

页面固定为四步：

1. 上传 `paid`、`tested`、`trial`、`registered` 四张必传表，`created` 可选。
2. 下载初版报表和 `missing_uins.csv`。
3. 在 Impala 查询待补 UIN，上传一个或多个查询结果表。
4. 选择保留或排除仍缺失的 UIN，下载最终报表。

本地运行与验证：

```bash
cd web
npm install
npm run dev
npm run test
npm run build
npm run test:sites
```

Vercel 部署时以 `web/` 为 Root Directory。部署配置和公开发布应在本地验证通过后再执行。

## 功能

- 按 `paid > tested > trial > created > registered` 优先级合并；`created` 未提供时自动跳过。
- 仅保留 `google` 和 `bingmkt` 两类广告来源。
- 将注册、创建、测试消耗、付费时间转换为漏斗阶段的 `0/1` 标记。
- 将广告系列内容拆分为区域、关键词类和细分词类。
- 分别生成 `Google`、`Bing` 两个工作表。
- 输出广告系列内容缺失或异常的 UIN 清单，供二次补数。
- 支持回填 UTM 数据、修复 `{campaign}`、清理 sitelink、修复部分乱码和推断缺失时间。
- 自动设置表头、字体、对齐、冻结首行、筛选和日期格式。

## 处理流程

```text
四张必传明细表 + created 可选表
  ↓ 合并、按 UIN 去重、筛选渠道
初版 Google/Bing 漏斗报表 + missing_uins.csv
  ↓ 人工按 UIN 补查 UTM 数据
补充表
  ↓ 回填、修复、清理、重排
最终漏斗明细报表
```

整个流程分为两个阶段。阶段一结束后，如果 `missing_uins.csv` 不为空，应先补查数据，再执行阶段二。不要自行猜测缺失的广告系列内容。

## 环境要求

- Python 3.9 或更高版本
- `pandas`
- `openpyxl`

建议在虚拟环境中安装依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

`requirements.txt` 至少需要包含：

```text
pandas
openpyxl
```

## 输入文件

阶段一需要四张结构相同的 `.xlsx` 文件，并支持一张可选文件：

- 注册用户明细
- 试用用户明细
- 测试消耗用户明细
- 付费用户明细
- 创建用户明细（可选）

核心字段：

```text
UIN
名称
创建场景
消耗场景
UIN类型
流量来源
首次访问时间
广告系列名称
广告系列内容
广告系列字词
浏览器语言
广告系列来源
注册时间
创建/领取时间
首次测试消耗时间
首次付费时间
```

程序目前只保留 `广告系列来源` 为 `google` 或 `bingmkt` 的记录。

## 快速开始

### 阶段一：合并并生成初版报表

在仓库根目录运行：

```bash
python scripts/build_report.py \
  --paid "付费表.xlsx" \
  --tested "测试表.xlsx" \
  --trial "试用表.xlsx" \
  --created "创建表.xlsx" \
  --registered "注册表.xlsx" \
  --out "SEM漏斗报表.xlsx"
```

运行后会生成：

- `SEM漏斗报表.xlsx`：包含 `Google`、`Bing` 两个工作表。
- `missing_uins.csv`：广告系列内容为空、为 `{campaign}` 或无法按规则解析的记录。

如果缺失清单不为空，请按 UIN 在神策、Impala 或其他数据平台补查 UTM 字段。

### 阶段二：回填补充数据并修复

补充表支持以下字段：

```text
user_id
first_utm_campaign
first_utm_content
first_utm_term
```

其中 `user_id` 对应 UIN。引荐流量的 UTM 为空属于正常情况，程序会跳过。

运行：

```bash
python scripts/fill_supplement.py \
  --report "SEM漏斗报表.xlsx" \
  --supplement "补充表.xlsx"
```

该命令会原地更新 `SEM漏斗报表.xlsx`。如需保留阶段一结果，请先复制一份报表。

没有补充表、只需要执行已有数据修复时，可以省略 `--supplement`：

```bash
python scripts/fill_supplement.py --report "SEM漏斗报表.xlsx"
```

## 输出字段

```text
投放渠道
UIN
首次访问时间
广告系列名称
广告系列内容
区域
关键词类
细分词类
广告系列字词
浏览器语言
注册用户-神策
创建应用
消耗用户数-神策
付费用户-神策
```

## 关键规则

### UIN 去重

输入表按以下优先级合并：

```text
paid > tested > trial > created > registered
```

同一 UIN 只保留优先级最高的一条记录。

### 广告系列内容拆分

标准格式：

```text
区域-Search-关键词类-细分词类-日期
```

程序以 `-Search-` 为边界拆分，兼容 `巴西--Search-...` 等双横线脏数据。

### 缺失时间推断

首次访问时间缺失时，程序优先在相同 UIN 前四位的记录中寻找数值最接近且已有时间的 UIN；找不到同前缀记录时，会退回全表最近 UIN。

这是近似推断，不是原始数据回填。对外使用报表前，应人工复核这些记录。

## 项目结构

```text
sem-user-funnel-report/
├── AGENTS.md
├── README.md
├── SKILL.md
├── requirements.txt
├── .gitignore
├── scripts/
    ├── build_report.py
    ├── common.py
    └── fill_supplement.py
└── web/
    ├── src/
    ├── tests/
    └── package.json
```

- `README.md`：项目说明和使用方法。
- `SKILL.md`：供 Codex 等代理执行该工作流时使用的规则。
- `scripts/build_report.py`：阶段一合并、去重、筛选和建表。
- `scripts/fill_supplement.py`：阶段二回填与修复。
- `scripts/common.py`：共用解析和 Excel 样式逻辑。
- `web/`：浏览器本地处理的可视化两阶段工作流。

## 数据安全

脚本在本地读取和生成文件，不需要把业务数据上传到第三方服务。公开 GitHub 仓库中不要提交：

- 真实用户明细和补充表
- UIN、名称、访问时间等个人或业务敏感数据
- 生成的 `SEM漏斗报表.xlsx`
- 生成的 `missing_uins.csv`
- Excel 临时锁文件
- Python 缓存和本地虚拟环境

建议 `.gitignore` 至少包含：

```gitignore
__pycache__/
*.py[cod]
.venv/
.DS_Store
~$*.xlsx
missing_uins.csv
*.xlsx
```

如果未来需要提交脱敏样例 Excel，可以为指定文件增加例外规则，例如：

```gitignore
!examples/sample_input.xlsx
```

## 当前边界

- 仅处理 Google 和 Bing 两类来源。
- 广告系列内容解析依赖 `-Search-` 命名规则。
- 阶段二会原地重写报表。
- 缺失时间采用近似推断，必须结合业务数据复核。
- 当前仓库未提供脱敏样例数据；前端核心规则已有自动化测试。
- 当前仓库未声明开源许可证；如需允许他人复用，应另行选择并添加 `LICENSE`。
