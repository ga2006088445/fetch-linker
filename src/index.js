import fs from 'fs/promises';
import fetch from 'node-fetch';
import { SocksProxyAgent } from "socks-proxy-agent";
import { resolve } from "path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import got from 'cloudflare-scraper';
dotenv.config();

import { runJQ } from "./jq.js";

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
    .option('e', {
        alias: 'exclude',
        describe: '排除目標工作 -e task1,task2',
        type: 'string',
    })
    .argv;

// 從 yargs 解析的參數
const { path: definitionPath, task: targetTaskName, debug: isDebugMode, exclude } = argv;
const excludes = exclude ? exclude.split(",") : [];

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
            .filter(([, deps]) => deps.size === 0)
            .map(([taskId, _]) => tasks.find(task => task.id === taskId));

        if (group.length === 0) {
            throw new Error("無法解析的依賴關係，可能不存在依賴工作或循環依賴。");
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

    // 透過兩個 regex 來判斷是否還有未替換的變數, 有的話就丟出空的資料
    const envRegex = /\$\{ENV\.([a-zA-Z0-9_-]+)\}/g;
    const flowRegex = /\$\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g;
    const hasEnvVariables =
        envRegex.test(JSON.stringify(headers)) ||
        envRegex.test(JSON.stringify(body)) ||
        flowRegex.test(JSON.stringify(headers)) ||
        flowRegex.test(JSON.stringify(body));
    if (hasEnvVariables) {
        isDebugMode ? console.error(`[ERROR] ${task.id} 有未替換的環境變數`) : null;
        isDebugMode ? console.error(`[ERROR] ${task.id} headers`, JSON.stringify(headers)) : null;
        isDebugMode ? console.error(`[ERROR] ${task.id} body`, JSON.stringify(body)) : null;
        console.log(`${task.id} : 依賴變數不存在，跳過執行`);
        return { header: {}, json: {} }
    }

    const newBody = {};
    if (task.method === "POST" && headers["content-type"] === "application/json") {
        newBody["body"] = JSON.stringify(body);
    } else if (task.method === "POST" && headers["content-type"] === "application/x-www-form-urlencoded") {
        newBody["body"] = new URLSearchParams(body).toString();
    }

    const requestInit = {
        method: task.method,
        headers: headers,
        ...newBody
    }

    isDebugMode ? console.log(`[DEBUG] ${task.id} 查看發送的請求`, JSON.stringify({
        url: task.url,
        ...requestInit
    })) : null;

    // 發送請求
    const agent = new SocksProxyAgent(process.env.SOCKS5_PROXY);

    const response = task.method === "GET" ?
        got.get(task.url, { agent, ...requestInit }) :
        got.post(task.url, { agent, ...requestInit });
    // await fetch(task.url, { agent, ...requestInit });

    const header = response.headers.raw();
    const resBody = await response.text();

    // 如果回應可以解析為 JSON，則解析為 JSON, 不能則回傳 content : resBody
    try {
        const json = JSON.parse(resBody);
        isDebugMode ? console.log(`[DEBUG] ${task.id} 查看回應`, JSON.stringify({
            header,
            body: json
        })) : null;

        return { header, json };
    } catch (error) {
        const json = { content: resBody };
        isDebugMode ? console.log(`[DEBUG] ${task.id} 查看回應`, JSON.stringify({
            header,
            body: json
        })) : null;

        return { header, json: json };
    }
}

// 替換系統環境變數, ${ENV.BILIBILI_COOKIE}
function replaceEnvVariables(obj) {
    if (!obj) return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => {
            const envRegex = /\$\{ENV\.([a-zA-Z0-9_-]+)\}/g;
            let match;
            while ((match = envRegex.exec(value)) !== null) {
                if (match && match.length === 2 && process.env[match[1]]) {
                    const replaceString = process.env[match[1]];
                    const newValue = value.replace(`\${ENV.${match[1]}}`, replaceString);
                    return [key, newValue];
                }
            }
            return [key, value]
        })
    );
}

// 替換此次 Flow 的共用變數, ${get-daily-task-status.cookieAA}
function replaceFlowVariables(obj, flowVariables) {
    if (!obj) return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => {
            const flowRegex = /\$\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g;
            let match;
            while ((match = flowRegex.exec(value)) !== null) {
                if (match && match.length === 3 && flowVariables[`${match[1]}.${match[2]}`]) {
                    const replaceString = flowVariables[`${match[1]}.${match[2]}`];
                    const newValue = value.replace(`\${${match[1]}.${match[2]}}`, replaceString)
                    return [key, newValue];
                }
            }
            return [key, value]
        })
    );
}

async function parsePath(valuePath, { header, body }) {
    // 使用 split 方法將字串分割為數組，並使用解構賦值取得第一個元素和剩餘部分
    const [firstPart, ...rest] = valuePath.split(".");

    // 將剩餘部分使用 join 方法重新組合成字串，並在前面加上點
    const secondPart = "." + rest.join(".");

    const isHeader = firstPart === "header";
    const json = isHeader ? header : body;

    const currentValue = await runJQ(json, secondPart);
    return currentValue;

}

// 主程式
async function main() {
    // 讀取定義檔案
    const definition = await loadDefinition(definitionPath);

    // 先排除不執行的工作
    const reservedTasks = definition.filter(task => !task.id || !excludes.includes(task.id));

    // 取得目標工作及其依賴
    const taskLayers = getDependencies(targetTaskName, reservedTasks);

    const flowVariables = {};
    const executeAndParse = async (thisTask) => {
        console.log(`${thisTask.id} : ${thisTask.display?.start}` || `開始執行 ${thisTask.id}`);
        const { header, json } = await executeTask(thisTask, flowVariables);

        // 把顯示條件呈現出來
        const conditions = thisTask.display?.conditions || {};
        const logConditionsTask = Object.entries(conditions).map(async ([key, valuePath]) => {
            const currentValue = await parsePath(valuePath, { header, body: json })
            console.log(`${thisTask.id} : ${key} = ${currentValue}`);
        });
        await Promise.all(logConditionsTask);
        console.log(`${thisTask.id} : ${thisTask.display?.end}` || `結束執行 ${thisTask.id}`);

        // 儲存導出的參數
        const exportTasks = Object.entries(thisTask.export || {}).map(async ([key, valuePath]) => {
            const currentValue = await parsePath(valuePath, { header, body: json })
            if (typeof currentValue !== "string" && currentValue !== null) {
                throw new Error(`導出的參數必須是 string，但是 ${key} 是 ${typeof currentValue}`);
            }
            flowVariables[`${thisTask.id}.${key}`] = currentValue;
        });
        await Promise.all(exportTasks);

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
