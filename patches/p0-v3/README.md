# 《寶島逗陣行》P0 深層錯誤修正工具 v3

日期：2026-11-14

**重要界線：本壓縮包是修正過的獨立 QA／程式候選模組，並非原 Sites 專案已部署的新版遊戲。**

原站：`https://baodao-travel-gpt.fphsatw-3248.chatgpt.site/`
原專案 ID：`appgprj_6af7c4215d908191b1f87791a5e83cb8`

這一輪實際重新檢查了上一版修復套件的 `audio-director.mjs`、`render-watch.mjs`、`road-guard.mjs`，並新增 11 項回歸檢查。在修改前新增回歸測試有 5 項失敗；修正後原有加新增合計 34／34 通過。

## 確認已修的 **工具程式缺陷**

1. 原 `AudioDirector` 只在手動呼叫 `stop()` 時刪除語音 handle。自然播完後 `voice.size` 不降，主配樂音量可能長期卡在 35%。新版支援 handle 的 `ended` Promise、`onEnded` callback 或 `ended` 事件，自動解除背景音樂 duck。
2. 原 `AudioDirector` 的已播放短音效會持續留在 `sfx` Set，長局可能累積音源控制參照。新版在自然結束後自動清理，且在音訊介面未提供 ended 通知時啟用可配置的並行上限（預設 12）。
3. 新台詞會停止上一句，切場會終止舊句、過期載入不能重新播放，音樂可依設定立即靜音。
4. 原 `compareSnapshots` 只比對前後「都還存在」的 Mesh；整棟建物被從 `scene.children` 拔掉時會漏判。新版會回報 `SOLID_MESH_REMOVED`。
5. 父群組或子物件被縮放到零同樣會使建築不可見，原版沒抓到。新版回報 `SOLID_ZERO_SCALE`。
6. 原 `road-guard` 用 20 邊形近似圓形碰撞體，狹窄角度可漏判剛好侵入道路邊緣的柱子、花盆。新版對圓形使用精確點到線段距離，並拒絕 NaN／Infinity 道路資料。

這些是**可重現的獨立工具程式錯誤**，不能把它們等同於原網站的實際故障根因，因為目前的會話無法讀取原 Sites 專案的完整程式碼。

## 目錄

- `src/audio-director.mjs`：音樂／環境／單次音效／語音的單一生命週期管理器。
- `src/render-watch.mjs`：實體 Mesh 透明、消失、被移除、零縮放與共享材質問題的只讀檢查。
- `src/road-guard.mjs`：折線道路與圓形／旋轉矩形／多邊形碰撞體的淨空檢查。
- `src/geometry.mjs`：共享二維幾何計算。
- `src/audit-scene-json.mjs`：在真正場景匯出 JSON 上運行道路檢查的命令列工具。
- `tests/guard.test.mjs`：前輪保留的 23 項測試。
- `tests/regression.test.mjs`：這輪增加的 11 項測試。
- `tests/before.txt`：新版回歸測試套上舊模組時，5 項實際失敗紀錄。
- `tests/after.txt`：修正後 34 項測試全數通過紀錄。
- `demo-scene-pass.json`：虛構、可通行的示例資料。
- `demo-scene-fail.json`：虛構、樹木壓到道路的反例。

## 本機驗證

需要 Node.js 20 以上版本：

```sh
sh run-qa.sh
```

其中故意阻路的 `demo-scene-fail.json` 必須產生 `FAIL` 與退出碼 1，才是正常結果。

## 真正整合原網站時必做

1. 先備份原站程式、目前部署版本、既有 `localStorage`／IndexedDB 存檔格式，不要清掉用戶遊戲進度。
2. 在 `SceneGraph` 中找出 `visible`、`material.opacity`、`material.transparent`、`mesh.scale`、`scene.remove()`、相機遮擋、LOD 及每次場景重建處。拍攝同一個固定遊戲狀態的前後視角，使用 `snapshotVisibility` 差異報表找出真實消失原因。
3. 匯出原站「真正」的道路中心線、道路寬度、人物碰撞半徑和每個裝飾品／建築的 footprint。請在建築初建、升級、換季與災害生成前，呼叫 `auditRoads` 或 `placeSafely`。禁止把「decorativeOnly」直接當成 `collidable=false`。
4. 在現有 `Audio`／WebAudio 轉接層提供 `load`、`start` 及 `ended` 或 `onEnded`，再把舊的 `new Audio`／`playBGM`／`playSFX` 呼叫整合到唯一管理器。音訊載入失敗時不得修改骰點或遊戲金錢狀態。
5. 比對原始完整遊戲設計，補足地方景點、建築、角色、音樂音色與任務。注意此套件不包括新編曲、錄製配音或高模 3D 美術，**不能用 34／34 通過宣稱美術與音質已達標**。
6. 在原站不同人數與各種季節、鏡頭、建築狀態中實際連續遊玩；保留錄影、截圖、控制台錯誤、固定隨機種子和原版／新版 build ID，通過後才部署原站。

## 已知限制

- 此處只做 X/Z 地面路徑淨空；上下層、橋上橋下、飛越障礙需要原站 3D navmesh／高度區間校驗，不能只靠此工具。
- 相機 frustum、WebGL 深度緩衝區、貼圖壓縮、渲染排序與 GPU 相容性需在**真正的遊戲頁面和手機上**測試。
- LOD 正常替換也會被 `SOLID_MESH_REMOVED` 提示；整合時必須對照預期的替代模型，避免把正常卸載誤判成錯誤。
- 音訊轉接層若沒提供一段音效自然結束的通知，管理器仍會透過並行上限抑制累積，但應優先補齊 `ended` 訊號。
- **未取得原 Sites 編輯及發布能力，這輪未實際在原站玩一場、未更新原網址，也未驗證用戶手機上的問題已解決。**
