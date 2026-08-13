#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段一：四张必传表 + created 可选表 -> Google/Bing 漏斗报表 + 缺失UIN清单

用法:
  python build_report.py --paid 付费.xlsx --tested 测试.xlsx \
      --trial 试用.xlsx --registered 注册.xlsx [--created 创建.xlsx] --out 报表.xlsx
"""
import argparse
import os
import pandas as pd
from common import apply_parse, style_workbook, COLUMNS

PRIORITY = ['paid', 'tested', 'trial', 'created', 'registered']  # 字段最全的优先保留
CHANNEL = {'google': '谷歌', 'bingmkt': '必应'}


def main():
    ap = argparse.ArgumentParser()
    for tag in PRIORITY:
        ap.add_argument(f'--{tag}', required=tag != 'created')
    ap.add_argument('--out', default='SEM漏斗报表.xlsx')
    args = ap.parse_args()

    # 1) 按优先级拼接后按 UIN 去重
    dfs, total = [], 0
    for tag in PRIORITY:
        source = getattr(args, tag)
        if not source:
            continue
        df = pd.read_excel(source)
        total += len(df)
        dfs.append(df)
    merged = pd.concat(dfs, ignore_index=True)
    dedup = merged.drop_duplicates(subset='UIN', keep='first').reset_index(drop=True)
    print(f'合计 {total} 行，去重后 {len(dedup)}（去掉 {total - len(dedup)} 条重复）')

    # 2) 只保留 google / bingmkt
    dedup = dedup[dedup['广告系列来源'].isin(CHANNEL)].reset_index(drop=True)
    print(f'筛渠道后 {len(dedup)} 行:', dedup['广告系列来源'].value_counts().to_dict())

    # 3) 建目标结构（时间列转 0/1）
    out = pd.DataFrame({
        '投放渠道': dedup['广告系列来源'].map(CHANNEL),
        'UIN': dedup['UIN'],
        '首次访问时间': pd.to_datetime(dedup['首次访问时间']).dt.date,
        '广告系列名称': dedup['广告系列名称'],
        '广告系列内容': dedup['广告系列内容'],
        '区域': '', '关键词类': '', '细分词类': '',
        '广告系列字词': dedup['广告系列字词'],
        '浏览器语言': dedup['浏览器语言'],
        '注册用户-神策': 1,
        '创建应用': dedup['创建/领取时间'].notna().astype(int),
        '消耗用户数-神策': dedup['首次测试消耗时间'].notna().astype(int),
        '付费用户-神策': dedup['首次付费时间'].notna().astype(int),
    })[COLUMNS]
    out = apply_parse(out)
    out = out.sort_values(['首次访问时间', 'UIN']).reset_index(drop=True)

    # 4) 缺失清单：内容为空 / {campaign} / 无法解析
    bad = out['区域'] == ''
    miss_path = os.path.join(os.path.dirname(os.path.abspath(args.out)) or '.', 'missing_uins.csv')
    out[bad][['UIN', '广告系列名称', '广告系列内容']].to_csv(miss_path, index=False, encoding='utf-8-sig')
    print(f'广告系列内容缺失/异常 {bad.sum()} 行，UIN 清单已写入 {miss_path}')
    print('>>> 请将该清单交给用户，按 UIN 重查 utm 数据后运行 fill_supplement.py')

    # 5) 分 sheet 输出 + 样式
    with pd.ExcelWriter(args.out, engine='openpyxl') as w:
        for sheet, ch in [('Google', '谷歌'), ('Bing', '必应')]:
            sub = out[out['投放渠道'] == ch]
            sub.to_excel(w, sheet_name=sheet, index=False)
            print(sheet, len(sub), '行')
    style_workbook(args.out)
    print('完成:', args.out)


if __name__ == '__main__':
    main()
