import { exec } from 'child_process';
import path from "path";

export function runJQ(jsonInput, jqFilter, jqPath = process.env.JQ_PATH || "./jq") {
    return new Promise((resolve, reject) => {
        const jsonString = JSON.stringify(jsonInput);
        const jP = path.resolve(process.cwd(), jqPath);
        const jqCommand = `echo '${jsonString}' | ${jP} '${jqFilter}'`;

        try {
            exec(jqCommand, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr);
                } else {
                    try {
                        const value = JSON.parse(stdout);
                        resolve(value);
                    } catch (jsonError) {
                        // JSON 解析失敗，處理錯誤
                        reject(`JSON 解析失敗：${jsonError}`);
                    }
                }
            });
        } catch (execError) {
            // exec 出現異常，處理錯誤
            reject(`exec 出現異常：${execError}`);
        }
    });
}