# fetch-linker CLI 工具使用說明
這個 CLI 工具允許用戶根據一個 JSON 定義檔案來自動化執行一系列網路請求。這些請求可以相互依賴，並且可以從環境變數或之前的請求中獲取數據。

### 安裝
npm install

### 定義檔案格式
參考 `./definition/bilibili/watch-video.json`
定義檔案是一個 JSON 格式的文件，其中包含一系列任務定義。每個任務可以包含以下字段：
- `id`: 任務的唯一標識符。
- `url`: 任務請求的目標 URL。
- `method`: HTTP 方法（如 GET、POST）。
- `headers`: 請求頭部。可以包含替換字段。
- `body`: 請求的 body 內容。對於 POST 請求。可以包含替換字段。
- `export`: 從此任務響應中導出的數據。Record<KEY, 對應位置>。
- `dependencies`: 此任務依賴的其他任務 ID 列表。
- `display`: 任務過程呈現的資料與訊息。

#### 字段替換規則
在 `headers` 和 `body` 中，您可以使用以下格式來指示替換：

使用 `${ENV.VARIABLE_NAME}` 來引用環境變數 ENV_VARIABLE。
使用 `${taskId.OtherTaskId.OutputKey}` 來引用其他任務的輸出。但是其他任務需要 export 其數據
例如，如果您想引用 ID 為 loginTask 的任務中導出的 token，您可以使用 ${task.loginTask.token}。

#### export 擷取資料規則 
使用 `"body.keyA"` 等索引尋找
可使用 陣列 `"body.keyA.[0]"`, `"body.keyA.[1]"`

### 使用方法
node ./src/index.js "./definition/bilibili/watch-video.json" "watch-video"