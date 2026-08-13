export const REQUIRED_HEADERS = [
  "UIN",
  "名称",
  "创建场景",
  "消耗场景",
  "UIN类型",
  "流量来源",
  "首次访问时间",
  "广告系列名称",
  "广告系列内容",
  "广告系列字词",
  "浏览器语言",
  "广告系列来源",
  "注册时间",
  "创建/领取时间",
  "首次测试消耗时间",
  "首次付费时间",
];

export const OUTPUT_HEADERS = [
  "投放渠道",
  "UIN",
  "首次访问时间",
  "广告系列名称",
  "广告系列内容",
  "区域",
  "关键词类",
  "细分词类",
  "广告系列字词",
  "浏览器语言",
  "注册用户-神策",
  "创建应用",
  "消耗用户数-神策",
  "付费用户-神策",
];

export const STAGES = [
  { key: "paid", label: "付费", required: true, priority: 0 },
  { key: "tested", label: "测试", required: true, priority: 1 },
  { key: "trial", label: "试用", required: true, priority: 2 },
  { key: "registered", label: "注册", required: true, priority: 4 },
  { key: "created", label: "创建", required: false, priority: 3 },
];

export const PRIORITY = ["paid", "tested", "trial", "created", "registered"];

export const CHANNELS = {
  google: "谷歌",
  bingmkt: "必应",
};

export const QUERY_HEADERS = [
  "user_id",
  "first_utm_campaign",
  "first_utm_content",
  "first_utm_term",
];
