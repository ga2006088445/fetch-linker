import fs from 'fs/promises';
import fetch from 'node-fetch';
import { resolve } from "path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
dotenv.config();

// 解析命令列參數
const argv = yargs(hideBin(process.argv))
    .env('DEBUG_')
    .option('p', {
        alias: 'path',
        describe: '定義檔案的路徑',
        type: 'string',
        demandOption: true,
    })
    .option('t', {
        alias: 'task',
        describe: '目標工作名稱',
        type: 'string',
    })
    .option('d', {
        alias: 'debug',
        describe: '啟用除錯模式',
        type: 'boolean',
        default: false,
    })
    .argv;

// 從 yargs 解析的參數
const { path: definitionPath, task: targetTaskName, debug: isDebugMode } = argv;

// 讀取和解析 JSON 定義檔案
async function loadDefinition(path) {
    const content = await fs.readFile(resolve(process.cwd(), path), 'utf8');
    return JSON.parse(content);
}

// 計算其執行工作分群排序
function getDependencies(targetTaskName, definition) {
    if (!targetTaskName) {
        // 當沒有指定目標工作時，執行所有工作，且使用分群排序
        return groupTasksByDependencies(definition);
    } else {
        const order = [];
        const toProcess = [targetTaskName];

        while (toProcess.length > 0) {
            const current = toProcess.pop();
            const task = definition.find(t => t.id === current);
            order.push(task);

            if (task.dependencies) {
                toProcess.push(...task.dependencies);
            }
        }
        const result = groupTasksByDependencies(order);
        // 並使用分群排序
        return result;
    }
}

// 分群排序
export function groupTasksByDependencies(tasks) {
    const taskDependencies = new Map(tasks.map(task => [task.id, new Set(task.dependencies || [])]));
    const groups = [];

    while (taskDependencies.size > 0) {
        // 查找依賴清單為空的工作
        const group = Array.from(taskDependencies.entries())
            .filter(([taskId, deps]) => deps.size === 0)
            .map(([taskId, _]) => tasks.find(task => task.id === taskId));

        if (group.length === 0) {
            throw new Error("無法解析的依賴關係，可能存在循環依賴。");
        }

        groups.push(group);

        // 更新依賴清單
        group.forEach(task => taskDependencies.delete(task.id));
        taskDependencies.forEach((deps, taskId) => {
            group.forEach(task => deps.delete(task.id));
        });
    }

    return groups;
}



// 執行工作
async function executeTask(task, envVariables) {
    // 替換參數和 ENV 變數
    const headers = replaceEnvVariables(replaceFlowVariables(task.headers, envVariables));
    const body = replaceEnvVariables(replaceFlowVariables(task.body, envVariables));

    const newBody = {};
    if (headers["Content-Type"] === "application/x-www-form-urlencoded") {
        newBody["body"] = JSON.stringify(body);
    } else if (task.method === "POST") {
        newBody["body"] = new URLSearchParams(body).toString();
    }

    // 發送請求
    const response = await fetch(task.url, {
        method: task.method,
        headers: headers,
        ...newBody
    });

    const header = response.headers.raw();
    const json = await response.json();
    return { header, json };
}

// 替換系統環境變數, ${ENV.BILIBILI_COOKIE}
function replaceEnvVariables(obj) {
    const regex = /\$\{ENV\.([a-zA-Z0-9_-]+)\}/g;

    if (!obj) return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) =>
            [key, typeof value === 'string' ? value.replace(regex, (_, name) => process.env[name] ?? value) : value]
        )
    );
}

// 替換此次 Flow 的共用變數, ${get-daily-task-status.cookieAA}
function replaceFlowVariables(obj, flowVariables) {
    const regex = /\$\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g;

    if (!obj) return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) =>
            [key, typeof value === 'string' ? value.replace(regex, (_, task, variable) => flowVariables[`${task}.${variable}`] ?? value) : value]
        )
    );
}

function parsePath(valuePath, { header, body }) {
    const pathParts = valuePath.split('.').filter(p => p !== ""); // 移除空字符串
    const source = pathParts.shift(); // 'header' 或 'body'

    let currentValue = source === "header" ? header : body;
    pathParts.forEach(part => {
        if (part.endsWith(']')) {
            // 處理陣列索引，例如 "c[0]"
            const [_, indexPart] = part.split('[');
            const indexStr = indexPart.replace(']', '')

            if (indexStr === "?") {
                // 如果是隨機索引 "[?]"
                const arrayLength = currentValue?.length;
                if (arrayLength > 0) {
                    const randomIndex = Math.floor(Math.random() * arrayLength);
                    currentValue = currentValue?.[randomIndex];
                } else {
                    currentValue = undefined;
                }
            } else {
                // 如果是特定索引 "[0]"，"[1]" 等
                const index = parseInt(indexStr, 10);
                currentValue = currentValue?.[index];
            }

        } else {
            // 正常處理非陣列屬性
            currentValue = currentValue?.[part];
        }
    });

    return currentValue;
}

// 主程式
async function main() {
    // 讀取定義檔案
    const definition = await loadDefinition(definitionPath);

    // 取得目標工作及其依賴
    const taskLayers = getDependencies(targetTaskName, definition);

    const flowVariables = {};
    const executeAndParse = async (thisTask) => {
        console.log(thisTask.display?.start || `開始執行 ${thisTask.id}`);
        const { header, json } = await executeTask(thisTask, flowVariables);

        // 把顯示條件呈現出來
        const conditions = thisTask.display?.conditions || {};
        Object.entries(conditions).map(([key, valuePath]) => {
            const currentValue = parsePath(valuePath, { header, body: json })
            console.log(`${thisTask.id} ${key} = ${currentValue}`);
        });
        console.log(thisTask.display?.end || `結束執行 ${thisTask.id}`);

        // 儲存導出的參數
        Object.entries(thisTask.export || {}).forEach(([key, valuePath]) => {
            const currentValue = parsePath(valuePath, { header, body: json })
            flowVariables[`${thisTask.id}.${key}`] = currentValue;
        });

        const isLastTask = targetTaskName === thisTask.id;
        if (isLastTask) {
            isDebugMode ? console.log(`[DEBUG] ${thisTask.id} 查看目標工作的可導出參數`, JSON.stringify({ header, body: json })) : null;
        }
    }

    for (const layer of taskLayers) {
        await Promise.all(layer.map(async task => {
            await executeAndParse(task)
        }));
    }

    isDebugMode ? console.log("[DEBUG] 查看整體 flowVariables", JSON.stringify(flowVariables)) : null;
    console.log("done");
}

main().catch(err => console.error(err));
