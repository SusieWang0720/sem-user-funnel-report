#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段二：回填补充数据 + 五类修复（原地更新报表）

用法:
  python fill_supplement.py --report 报表.xlsx [--supplement 补充表.xlsx]

补充表列名: user_id, first_utm_campaign, first_utm_content, first_utm_term
（引荐流量行 utm 为空属正常，自动跳过）
"""
import argparse
import re
import pandas as pd
from common import apply_parse, style_workbook

MOJIBAKE_RULES = [
    ('通�+词', '通用词'), ('�+用词', '通用词'), ('通用�+(?=-)', '通用词'),
    ('�+牌词', '品牌词'), ('竞�+词', '竞品词'),
    ('�+南-', '越南-'), ('越�+-', '越南-'), ('�+马泰新印', '越马泰新印'),
    ('�+澳台', '港澳台'), ('�+度-', '印度-'), ('�+加坡', '新加坡'),
]


def is_empty_content(v):
    return pd.isna(v) or str(v).strip() in ('', '{campaign}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', required=True)
    ap.add_argument('--supplement')
    args = ap.parse_args()

    sheets = pd.read_excel(args.report, sheet_name=None)

    # 补充表: UIN -> utm 三字段
    sup = pd.DataFrame()
    if args.supplement:
        sup = pd.read_excel(args.supplement).dropna(subset=['first_utm_content'])
        sup = sup.set_index('user_id')
        print('补充表有效行:', len(sup))

    # 相同广告系列ID -> 正常内容（众数），用于 {campaign} 与乱码修复
    alldf = pd.concat(sheets.values())
    clean = alldf[alldf['广告系列内容'].astype(str).str.contains('-Search-', na=False)
                  & ~alldf['广告系列内容'].astype(str).str.contains('�', na=False)]
    id2content = clean.groupby(clean['广告系列名称'].astype(str))['广告系列内容'] \
                      .agg(lambda s: s.mode()[0]).to_dict()

    stats = dict(filled=0, campaign=0, sitelink=0, mojibake=0, time=0)
    for name, df in sheets.items():
        df['广告系列名称'] = df['广告系列名称'].astype(object)  # 避免数字/文本混合的 dtype 警告
        # 1) 回填补充数据（只填空行）
        if len(sup):
            for i, row in df.iterrows():
                if is_empty_content(row['广告系列内容']) and row['UIN'] in sup.index:
                    s = sup.loc[row['UIN']]
                    df.at[i, '广告系列名称'] = s['first_utm_campaign']
                    df.at[i, '广告系列内容'] = s['first_utm_content']
                    if pd.notna(s.get('first_utm_term')):
                        df.at[i, '广告系列字词'] = s['first_utm_term']
                    stats['filled'] += 1

        # 2) {campaign} 占位符按广告系列ID匹配
        for i, row in df.iterrows():
            if str(row['广告系列内容']).strip() == '{campaign}':
                ref = id2content.get(str(row['广告系列名称']))
                if ref:
                    df.at[i, '广告系列内容'] = ref
                    stats['campaign'] += 1

        # 3) 删 sitelink 行
        m = df['广告系列字词'].astype(str).str.contains('sitelink', case=False, na=False)
        stats['sitelink'] += int(m.sum())
        df = df[~m].reset_index(drop=True)

        # 4) 乱码修复：优先同ID正常内容，兜底规则替换
        for i, row in df.iterrows():
            c = row['广告系列内容']
            if isinstance(c, str) and '�' in c:
                ref = id2content.get(str(row['广告系列名称']))
                if ref:
                    c = ref
                else:
                    for pat, rep in MOJIBAKE_RULES:
                        c = re.sub(pat, rep, c)
                df.at[i, '广告系列内容'] = c
                stats['mojibake'] += 1

        # 5) 缺失时间：同前缀系列内取 UIN 最接近者的时间
        df['首次访问时间'] = pd.to_datetime(df['首次访问时间'])
        miss = df['首次访问时间'].isna()
        if miss.any():
            known = df[~miss][['UIN', '首次访问时间']].copy()
            known['prefix'] = known['UIN'].astype(str).str[:4]
            for i in df[miss].index:
                uin = df.at[i, 'UIN']
                pool = known[known['prefix'] == str(uin)[:4]]
                if pool.empty:
                    pool = known
                nearest = pool.iloc[(pool['UIN'] - uin).abs().argmin()]
                df.at[i, '首次访问时间'] = nearest['首次访问时间']
                stats['time'] += 1

        df = apply_parse(df)
        df = df.sort_values(['首次访问时间', 'UIN']).reset_index(drop=True)
        df['首次访问时间'] = df['首次访问时间'].dt.date
        sheets[name] = df

    with pd.ExcelWriter(args.report, engine='openpyxl') as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name, index=False)
    style_workbook(args.report)

    print('回填 {filled} 行 | {{campaign}} 修复 {campaign} | 删 sitelink {sitelink} 行 | '
          '乱码修复 {mojibake} | 补时间 {time}'.format(**stats))
    left = sum(df['区域'].astype(str).eq('').sum() for df in sheets.values())
    print('仍无法解析:', left, '行 |', {n: len(d) for n, d in sheets.items()})


if __name__ == '__main__':
    main()
