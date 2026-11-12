# 星辰盤（MVPの範囲）のノードの一覧

> `pnpm report:star` で、データから作る（手で書き換えない）。暫定の採用（docs/progress D-FIN-3）。
> 仕様書v0.2：4.3（ノードの種類）・4.4（星座）・4.12（ポイント：MVP は Lv20 の19＋クエスト4＋探索2＝25）

## 数

| 星域 | 始点 | 小星 | 輝星 | 転変 | 天極 | 星門 | 共鳴座 | 合計 |
|---|---|---|---|---|---|---|---|---|
| 剛域 | 1 | 38 | 4 | 1 | 2 | 1 | 0 | 47 |
| 剛迅域 | 0 | 26 | 2 | 0 | 1 | 0 | 0 | 29 |
| 迅域 | 1 | 49 | 6 | 1 | 2 | 1 | 0 | 60 |
| 迅理域 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| 合計 | 2 | 119 | 12 | 2 | 5 | 2 | 0 | 142 |

## 星座（仕様書v0.2 4.4）

| 星座 | 小星の数 | 完成ボーナス |
|---|---|---|
| 毒蛇座 | 9 | 毒の敵が通った場所の毒だまり+20% |
| 風見座 | 6 | 移動速度+5% |
| 双刃座 | 7 | 二刀流の2撃目の崩し値+30% |
| 鍛冶座 | 8 | ダメージ+0.4% |
| 影法師座 | 7 | 影縫いの装束の仮想部位+1 |

## ノード

| ID | 星域 | 種類 | 名前・星座 | 効果 | つながり |
|---|---|---|---|---|---|
| STAR-GATE-BLADE | 剛域 | 星門 | 刃の門 |  | STAR-GOU-0004 STAR-GOU-0101 |
| STAR-GOU-0001 | 剛域 | 小星 |  | 剛+10 | STAR-GOU-0002 STAR-GOU-0201 STAR-GOU-START |
| STAR-GOU-0002 | 剛域 | 小星 |  | 剛+5、迅+5 | STAR-GOU-0001 STAR-GOU-0003 STAR-KEY-BURDEN |
| STAR-GOU-0003 | 剛域 | 小星 |  | 剛+10 | STAR-GOU-0002 STAR-GOU-0004 |
| STAR-GOU-0004 | 剛域 | 小星 |  | 剛+5、迅+5 | STAR-GATE-BLADE STAR-GOU-0003 |
| STAR-GOU-0101 | 剛域 | 小星 |  | 剛+10 | STAR-GATE-BLADE STAR-GOU-0102 |
| STAR-GOU-0102 | 剛域 | 小星 |  | 剛+10 | STAR-GOU-0101 STAR-SM-BLADE-01 |
| STAR-GOU-0201 | 剛域 | 小星 |  | 剛+10 | STAR-GOU-0001 STAR-GOU-0202 STAR-KEY-BLOOD-PACT |
| STAR-GOU-0202 | 剛域 | 小星 |  | 剛+5、迅+5 | STAR-GOU-0201 STAR-SMITH-01 |
| STAR-GOU-START | 剛域 | 始点 | 剛域の始点（戦士） |  | STAR-GOU-0001 STAR-GOUJIN-0001 |
| STAR-GOUJIN-0001 | 剛域 | 小星 |  | 剛+5、迅+5 | STAR-GOU-START STAR-GOUJIN-0002 |
| STAR-GOUJIN-0002 | 剛域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0001 STAR-GOUJIN-0003 |
| STAR-KEY-BLOOD-PACT | 剛域 | 天極 | 血の盟約 | 技のコストをHPで支払う（MPコストの倍率）+1.5、HPの回復効果+30% | STAR-GOU-0201 |
| STAR-KEY-BURDEN | 剛域 | 天極 | 重荷の誇り | 移動速度+-12% ／ flag（条件付き） | STAR-GOU-0002 |
| STAR-MUT-HEAVY | 剛域 | 転変 | 重撃化 | [近接]崩し値+60%、[近接]ダメージ+30%、攻撃速度+-30%、重撃化+1 | STAR-SM-GOU-C-03 |
| STAR-NT-IRON-SKIN | 剛域 | 輝星 | 鉄の皮膚 | 防具値+30% | STAR-SM-GOU-B-03 |
| STAR-NT-LAYERS | 剛域 | 輝星 | 重ね着の妙 | 防具値+15%、回避値+15%、最大魔障+15%（条件付き） | STAR-SM-GOU-D-06 |
| STAR-NT-SEVERING | 剛域 | 輝星 | 断ち切る刃 | [近接]ダメージ+20%、崩れた敵への近接ダメージ+20% | STAR-SM-GOU-A-07 STAR-SM-GOU-D-01 |
| STAR-NT-SWORD-AURA | 剛域 | 輝星 | 剣気 | 剣気：衝撃波の確率+10% | STAR-SM-BLADE-01 |
| STAR-SM-BLADE-01 | 剛域 | 小星 |  | [近接]ダメージ+6% | STAR-GOU-0102 STAR-NT-SWORD-AURA |
| STAR-SM-GOU-A-01 | 剛域 | 小星 |  | 最大HP+12、防具値+2% | STAR-SM-GOU-A-02 STAR-SMITH-08 |
| STAR-SM-GOU-A-02 | 剛域 | 小星 |  | [近接]ダメージ+6% | STAR-SM-GOU-A-01 STAR-SM-GOU-A-03 |
| STAR-SM-GOU-A-03 | 剛域 | 小星 |  | 防具値+6%、最大HP+4 | STAR-SM-GOU-A-02 STAR-SM-GOU-A-04 STAR-SM-GOU-B-01 |
| STAR-SM-GOU-A-04 | 剛域 | 小星 |  | 崩し値+8%、[近接]ダメージ+2% | STAR-SM-GOU-A-03 STAR-SM-GOU-A-05 |
| STAR-SM-GOU-A-05 | 剛域 | 小星 |  | 剛+10 | STAR-SM-GOU-A-04 STAR-SM-GOU-A-06 |
| STAR-SM-GOU-A-06 | 剛域 | 小星 |  | 最大HP+12、防具値+2% | STAR-SM-GOU-A-05 STAR-SM-GOU-A-07 STAR-SM-GOU-C-01 |
| STAR-SM-GOU-A-07 | 剛域 | 小星 |  | [近接]ダメージ+6% | STAR-NT-SEVERING STAR-SM-GOU-A-06 |
| STAR-SM-GOU-B-01 | 剛域 | 小星 |  | 防具値+6%、最大HP+4 | STAR-SM-GOU-A-03 STAR-SM-GOU-B-02 |
| STAR-SM-GOU-B-02 | 剛域 | 小星 |  | 最大HP+12、防具値+2% | STAR-SM-GOU-B-01 STAR-SM-GOU-B-03 |
| STAR-SM-GOU-B-03 | 剛域 | 小星 |  | 防具値+6%、最大HP+4 | STAR-NT-IRON-SKIN STAR-SM-GOU-B-02 |
| STAR-SM-GOU-C-01 | 剛域 | 小星 |  | 崩し値+8%、[近接]ダメージ+2% | STAR-SM-GOU-A-06 STAR-SM-GOU-C-02 |
| STAR-SM-GOU-C-02 | 剛域 | 小星 |  | [近接]ダメージ+6% | STAR-SM-GOU-C-01 STAR-SM-GOU-C-03 |
| STAR-SM-GOU-C-03 | 剛域 | 小星 |  | 崩し値+8%、[近接]ダメージ+2% | STAR-MUT-HEAVY STAR-SM-GOU-C-02 |
| STAR-SM-GOU-D-01 | 剛域 | 小星 |  | 最大HP+12、防具値+2% | STAR-NT-SEVERING STAR-SM-GOU-D-02 |
| STAR-SM-GOU-D-02 | 剛域 | 小星 |  | 防具値+6%、最大HP+4 | STAR-SM-GOU-D-01 STAR-SM-GOU-D-03 |
| STAR-SM-GOU-D-03 | 剛域 | 小星 |  | 剛+10 | STAR-SM-GOU-D-02 STAR-SM-GOU-D-04 |
| STAR-SM-GOU-D-04 | 剛域 | 小星 |  | [近接]ダメージ+6% | STAR-SM-GOU-D-03 STAR-SM-GOU-D-05 |
| STAR-SM-GOU-D-05 | 剛域 | 小星 |  | 最大HP+12、防具値+2% | STAR-SM-GOU-D-04 STAR-SM-GOU-D-06 |
| STAR-SM-GOU-D-06 | 剛域 | 小星 |  | 防具値+6%、最大HP+4 | STAR-NT-LAYERS STAR-SM-GOU-D-05 |
| STAR-SMITH-01 | 剛域 | 小星 | 鍛冶座 | 防具値+5% | STAR-GOU-0202 STAR-SMITH-02 |
| STAR-SMITH-02 | 剛域 | 小星 | 鍛冶座 | [物理]ダメージ+5% | STAR-SMITH-01 STAR-SMITH-03 |
| STAR-SMITH-03 | 剛域 | 小星 | 鍛冶座 | 防具値+5% | STAR-SMITH-02 STAR-SMITH-04 |
| STAR-SMITH-04 | 剛域 | 小星 | 鍛冶座 | [物理]ダメージ+5% | STAR-SMITH-03 STAR-SMITH-05 |
| STAR-SMITH-05 | 剛域 | 小星 | 鍛冶座 | 防具値+5% | STAR-SMITH-04 STAR-SMITH-06 |
| STAR-SMITH-06 | 剛域 | 小星 | 鍛冶座 | [物理]ダメージ+5% | STAR-SMITH-05 STAR-SMITH-07 |
| STAR-SMITH-07 | 剛域 | 小星 | 鍛冶座 | 防具値+5% | STAR-SMITH-06 STAR-SMITH-08 |
| STAR-SMITH-08 | 剛域 | 小星 | 鍛冶座 | [物理]ダメージ+5% | STAR-SM-GOU-A-01 STAR-SMITH-07 |
| STAR-GOUJIN-0003 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0002 STAR-GOUJIN-0004 STAR-KEY-BARE-HANDS |
| STAR-GOUJIN-0004 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0003 STAR-GOUJIN-0005 |
| STAR-GOUJIN-0005 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0004 STAR-GOUJIN-0006 STAR-TWIN-01 |
| STAR-GOUJIN-0006 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0005 STAR-GOUJIN-0007 |
| STAR-GOUJIN-0007 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0006 STAR-GOUJIN-0008 |
| STAR-KEY-BARE-HANDS | 剛迅域 | 天極 | 徒手の極意 | 徒手の極意+1（条件付き） | STAR-GOUJIN-0003 |
| STAR-NT-CYCLE | 剛迅域 | 輝星 | 循環の泉 | 循環の泉：MP100ごとの職能ゲージ+5% | STAR-SM-GJ-B-03 |
| STAR-NT-GALE | 剛迅域 | 輝星 | 疾風の脚 | 移動速度+8%、疾風の脚：移動中の回避値+20% | STAR-SM-GJ-A-07 STAR-SM-GJ-C-01 |
| STAR-SM-GJ-A-01 | 剛迅域 | 小星 |  | 移動速度+2%、回避値+2% | STAR-SM-GJ-A-02 STAR-TWIN-07 |
| STAR-SM-GJ-A-02 | 剛迅域 | 小星 |  | 攻撃速度+3%（条件付き） | STAR-SM-GJ-A-01 STAR-SM-GJ-A-03 |
| STAR-SM-GJ-A-03 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-SM-GJ-A-02 STAR-SM-GJ-A-04 |
| STAR-SM-GJ-A-04 | 剛迅域 | 小星 |  | 移動速度+2%、回避値+2% | STAR-SM-GJ-A-03 STAR-SM-GJ-A-05 STAR-SM-GJ-B-01 |
| STAR-SM-GJ-A-05 | 剛迅域 | 小星 |  | 攻撃速度+3%（条件付き） | STAR-SM-GJ-A-04 STAR-SM-GJ-A-06 |
| STAR-SM-GJ-A-06 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-SM-GJ-A-05 STAR-SM-GJ-A-07 |
| STAR-SM-GJ-A-07 | 剛迅域 | 小星 |  | 移動速度+2%、回避値+2% | STAR-NT-GALE STAR-SM-GJ-A-06 |
| STAR-SM-GJ-B-01 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-SM-GJ-A-04 STAR-SM-GJ-B-02 |
| STAR-SM-GJ-B-02 | 剛迅域 | 小星 |  | 移動速度+2%、回避値+2% | STAR-SM-GJ-B-01 STAR-SM-GJ-B-03 |
| STAR-SM-GJ-B-03 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-NT-CYCLE STAR-SM-GJ-B-02 |
| STAR-SM-GJ-C-01 | 剛迅域 | 小星 |  | 攻撃速度+3%（条件付き） | STAR-NT-GALE STAR-SM-GJ-C-02 |
| STAR-SM-GJ-C-02 | 剛迅域 | 小星 |  | 移動速度+2%、回避値+2% | STAR-SM-GJ-C-01 STAR-SM-GJ-C-03 |
| STAR-SM-GJ-C-03 | 剛迅域 | 小星 |  | 剛+5、迅+5 | STAR-SM-GJ-C-02 STAR-SM-GJ-C-04 |
| STAR-SM-GJ-C-04 | 剛迅域 | 小星 |  | 攻撃速度+3%（条件付き） | STAR-SM-GJ-C-03 |
| STAR-TWIN-01 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-GOUJIN-0005 STAR-TWIN-02 |
| STAR-TWIN-02 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-TWIN-01 STAR-TWIN-03 |
| STAR-TWIN-03 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-TWIN-02 STAR-TWIN-04 |
| STAR-TWIN-04 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-TWIN-03 STAR-TWIN-05 |
| STAR-TWIN-05 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-TWIN-04 STAR-TWIN-06 |
| STAR-TWIN-06 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-TWIN-05 STAR-TWIN-07 |
| STAR-TWIN-07 | 剛迅域 | 小星 | 双刃座 | 攻撃速度+3%（条件付き） | STAR-SM-GJ-A-01 STAR-TWIN-06 |
| STAR-GATE-BEAST | 迅域 | 星門 | 獣の門 |  | STAR-JIN-0004 STAR-JIN-0101 |
| STAR-GOUJIN-0008 | 迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0007 STAR-GOUJIN-0009 |
| STAR-GOUJIN-0009 | 迅域 | 小星 |  | 剛+5、迅+5 | STAR-GOUJIN-0008 STAR-JIN-0011 STAR-VANE-01 |
| STAR-JIN-0001 | 迅域 | 小星 |  | 迅+10 | STAR-JIN-0002 STAR-JIN-0201 STAR-JIN-START |
| STAR-JIN-0002 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-JIN-0001 STAR-JIN-0003 STAR-NOTABLE-REOPEN |
| STAR-JIN-0003 | 迅域 | 小星 |  | 迅+10 | STAR-JIN-0002 STAR-JIN-0004 |
| STAR-JIN-0004 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-GATE-BEAST STAR-JIN-0003 |
| STAR-JIN-0011 | 迅域 | 小星 |  | 迅+10 | STAR-GOUJIN-0009 STAR-JIN-0012 STAR-JIN-START |
| STAR-JIN-0012 | 迅域 | 小星 |  | 迅+10 | STAR-JIN-0011 STAR-KEY-MYRIAD |
| STAR-JIN-0101 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-GATE-BEAST STAR-JIN-0102 |
| STAR-JIN-0102 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-JIN-0101 STAR-SM-BEAST-01 |
| STAR-JIN-0201 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-JIN-0001 STAR-JIN-0202 STAR-KEY-SHADOW-COPY |
| STAR-JIN-0202 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-JIN-0201 STAR-VIPER-01 |
| STAR-JIN-START | 迅域 | 始点 | 迅域の始点（盗賊） |  | STAR-JIN-0001 STAR-JIN-0011 |
| STAR-KEY-MYRIAD | 迅域 | 天極 | 千変 | 臨界で与える持続ダメージの残り+60% | STAR-JIN-0012 |
| STAR-KEY-SHADOW-COPY | 迅域 | 天極 | 影写し | 受けるダメージのうち、遅れて受ける割合+35% | STAR-JIN-0201 |
| STAR-MUT-BLOOD-BLADE | 迅域 | 転変 | 血の刃 | 血の刃+1、[出血]状態異常ダメージ+-30% | STAR-SM-JIN-D-03 STAR-SM-JIN-E-01 |
| STAR-NOTABLE-REOPEN | 迅域 | 輝星 | 傷口を抉る | 出血している敵へのヒットで、出血の持続を延ばす（秒）+1 | STAR-JIN-0002 |
| STAR-NT-CORRODE | 迅域 | 輝星 | 腐食の手 | 腐食の手：状態異常の敵の物理耐性の低下+10% | STAR-SM-JIN-C-03 |
| STAR-NT-FOCUS | 迅域 | 輝星 | 狙い澄まし | 狙い澄まし：会心率の増加+40% | STAR-SM-JIN-A-07 STAR-SM-JIN-D-01 |
| STAR-NT-HUNT | 迅域 | 輝星 | 狩りの本能 | 狩りの本能：HPが半分以下の敵へのダメージ+25% | STAR-SM-BEAST-01 |
| STAR-NT-SHADOW-STEP | 迅域 | 輝星 | 影踏み | 影踏み：回避の後の受けるダメージの軽減+25% | STAR-SM-JIN-B-03 |
| STAR-NT-VESSEL-JIN | 迅域 | 輝星 | 星の器 | 星の器+10% | STAR-SM-JIN-E-04 |
| STAR-SHADOW-01 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-02 STAR-SM-JIN-A-03 |
| STAR-SHADOW-02 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-01 STAR-SHADOW-03 |
| STAR-SHADOW-03 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-02 STAR-SHADOW-04 |
| STAR-SHADOW-04 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-03 STAR-SHADOW-05 |
| STAR-SHADOW-05 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-04 STAR-SHADOW-06 |
| STAR-SHADOW-06 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-05 STAR-SHADOW-07 |
| STAR-SHADOW-07 | 迅域 | 小星 | 影法師座 | 背面からの会心率+1% | STAR-SHADOW-06 |
| STAR-SM-BEAST-01 | 迅域 | 小星 |  | 会心率+8%、会心倍率+4% | STAR-JIN-0102 STAR-NT-HUNT |
| STAR-SM-JIN-A-01 | 迅域 | 小星 |  | 会心率+8%、会心倍率+4% | STAR-SM-JIN-A-02 STAR-VIPER-09 |
| STAR-SM-JIN-A-02 | 迅域 | 小星 |  | [毒]状態異常ダメージ+6%、[毒]状態異常の持続+0.3 | STAR-SM-JIN-A-01 STAR-SM-JIN-A-03 STAR-SM-JIN-B-01 |
| STAR-SM-JIN-A-03 | 迅域 | 小星 |  | 攻撃速度+3%、移動速度+1% | STAR-SHADOW-01 STAR-SM-JIN-A-02 STAR-SM-JIN-A-04 |
| STAR-SM-JIN-A-04 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-SM-JIN-A-03 STAR-SM-JIN-A-05 |
| STAR-SM-JIN-A-05 | 迅域 | 小星 |  | 回避値+6%、移動速度+1% | STAR-SM-JIN-A-04 STAR-SM-JIN-A-06 STAR-SM-JIN-C-01 |
| STAR-SM-JIN-A-06 | 迅域 | 小星 |  | 会心率+8%、会心倍率+4% | STAR-SM-JIN-A-05 STAR-SM-JIN-A-07 |
| STAR-SM-JIN-A-07 | 迅域 | 小星 |  | [毒]状態異常ダメージ+6%、[毒]状態異常の持続+0.3 | STAR-NT-FOCUS STAR-SM-JIN-A-06 |
| STAR-SM-JIN-B-01 | 迅域 | 小星 |  | 回避値+6%、移動速度+1% | STAR-SM-JIN-A-02 STAR-SM-JIN-B-02 |
| STAR-SM-JIN-B-02 | 迅域 | 小星 |  | 攻撃速度+3%、移動速度+1% | STAR-SM-JIN-B-01 STAR-SM-JIN-B-03 |
| STAR-SM-JIN-B-03 | 迅域 | 小星 |  | 回避値+6%、移動速度+1% | STAR-NT-SHADOW-STEP STAR-SM-JIN-B-02 |
| STAR-SM-JIN-C-01 | 迅域 | 小星 |  | [毒]状態異常ダメージ+6%、[毒]状態異常の持続+0.3 | STAR-SM-JIN-A-05 STAR-SM-JIN-C-02 |
| STAR-SM-JIN-C-02 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-SM-JIN-C-01 STAR-SM-JIN-C-03 |
| STAR-SM-JIN-C-03 | 迅域 | 小星 |  | [毒]状態異常ダメージ+6%、[毒]状態異常の持続+0.3 | STAR-NT-CORRODE STAR-SM-JIN-C-02 |
| STAR-SM-JIN-D-01 | 迅域 | 小星 |  | [出血]状態異常ダメージ+6%、[出血]状態異常の持続+0.3 | STAR-NT-FOCUS STAR-SM-JIN-D-02 |
| STAR-SM-JIN-D-02 | 迅域 | 小星 |  | 会心率+8%、会心倍率+4% | STAR-SM-JIN-D-01 STAR-SM-JIN-D-03 |
| STAR-SM-JIN-D-03 | 迅域 | 小星 |  | 迅+10 | STAR-MUT-BLOOD-BLADE STAR-SM-JIN-D-02 |
| STAR-SM-JIN-E-01 | 迅域 | 小星 |  | 攻撃速度+3%、移動速度+1% | STAR-MUT-BLOOD-BLADE STAR-SM-JIN-E-02 |
| STAR-SM-JIN-E-02 | 迅域 | 小星 |  | 回避値+6%、移動速度+1% | STAR-SM-JIN-E-01 STAR-SM-JIN-E-03 |
| STAR-SM-JIN-E-03 | 迅域 | 小星 |  | 迅+10 | STAR-SM-JIN-E-02 STAR-SM-JIN-E-04 |
| STAR-SM-JIN-E-04 | 迅域 | 小星 |  | 攻撃速度+3%、移動速度+1% | STAR-NT-VESSEL-JIN STAR-SM-JIN-E-03 |
| STAR-VIPER-01 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常ダメージ+8% | STAR-JIN-0202 STAR-VIPER-02 |
| STAR-VIPER-02 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常の持続+0.2 | STAR-VIPER-01 STAR-VIPER-03 |
| STAR-VIPER-03 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常ダメージ+8% | STAR-VIPER-02 STAR-VIPER-04 |
| STAR-VIPER-04 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常の持続+0.2 | STAR-VIPER-03 STAR-VIPER-05 |
| STAR-VIPER-05 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常ダメージ+8% | STAR-VIPER-04 STAR-VIPER-06 |
| STAR-VIPER-06 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常の持続+0.2 | STAR-VIPER-05 STAR-VIPER-07 |
| STAR-VIPER-07 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常ダメージ+8% | STAR-VIPER-06 STAR-VIPER-08 |
| STAR-VIPER-08 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常の持続+0.2 | STAR-VIPER-07 STAR-VIPER-09 |
| STAR-VIPER-09 | 迅域 | 小星 | 毒蛇座 | [毒]状態異常ダメージ+8% | STAR-SM-JIN-A-01 STAR-VIPER-08 |
| STAR-VANE-01 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-GOUJIN-0009 STAR-VANE-02 |
| STAR-VANE-02 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-VANE-01 STAR-VANE-03 |
| STAR-VANE-03 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-VANE-02 STAR-VANE-04 |
| STAR-VANE-04 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-VANE-03 STAR-VANE-05 |
| STAR-VANE-05 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-VANE-04 STAR-VANE-06 |
| STAR-VANE-06 | 迅理域 | 小星 | 風見座 | 移動速度+2% | STAR-VANE-05 |
