// ==UserScript==
// @name         快速图片翻译fast-image-translator
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  得益于Qwen3.5-35B-A3B这样强大的模型，我们可以本地部署强大的基于图片LLM的翻译服务了！右键配置LLM，可选择纯文字翻译（对于X这样无法直接替换图片的网站）。
// @author       AkatsukiKyouko
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ================= [1. 配置参数] =================
    const CONFIG = {
        get apiBaseUrl() { return GM_getValue('apiBaseUrl', 'http://127.0.0.1:1234/v1'); },
        get apiKey() { return GM_getValue('apiKey', 'your_api_key'); },
        get model() { return GM_getValue('model', 'qwen3.5'); },
        get extraBody() { return GM_getValue('extraBody', ''); },
        fontSize: 18,
        strokeWidth: 3,
        textColor: '#FFFFFF',
        strokeColor: '#000000',
        minImageSize: 150, // 提高最小图片尺寸，避免小图片显示图标
        minImageArea: 15000, // 添加最小面积检测（宽*高）
        sizeMapping: { 'small': 0.9, 'medium': 1.0, 'large': 1.2 },
        primaryGradient: 'linear-gradient(135deg, rgba(255, 182, 193, 0.8) 0%, rgba(255, 105, 180, 0.8) 100%)'
    };

    // 获取当前网站是否开启"一律文字翻译"
    const isAlwaysTextMode = () => GM_getValue('always_text_' + location.hostname, false);

    // 获取当前网站是否隐藏图标
    const isHideIcon = () => GM_getValue('hide_icon_' + location.hostname, false);

    // ================= [2. UI 样式] =================
    GM_addStyle(`
        .it-wrapper { position: fixed; z-index: 2147483647; display: none; align-items: center; justify-content: center; padding: 15px; margin: -15px; pointer-events: auto; }
        .it-btn { width: 32px; height: 32px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 15px; font-weight: bold; box-shadow: 0 4px 12px rgba(255, 105, 180, 0.2); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1.5px solid rgba(255, 255, 255, 0.4); user-select: none; background: ${CONFIG.primaryGradient}; }
        .it-loading { animation: it-pulse 1s infinite ease-in-out; pointer-events: none; }
        @keyframes it-pulse { 0%, 100% { opacity: 0.6; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.05); } }
        .it-popup { position: absolute; top: 40px; right: 0; width: max-content; max-width: 280px; max-height: 350px; overflow-y: auto; background: rgba(30, 30, 30, 0.7); color: #E0E0E0; padding: 12px 15px; padding-top: 20px; border-radius: 8px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 105, 180, 0.5); backdrop-filter: blur(8px); text-align: left; cursor: text; user-select: text; position: relative; }
        .it-popup-close { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; border: none; background: rgba(255, 105, 180, 0.3); color: #fff; border-radius: 50%; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
        .it-popup-close:hover { background: rgba(255, 105, 180, 0.6); }
        .it-popup::-webkit-scrollbar { width: 6px; }
        .it-popup::-webkit-scrollbar-thumb { background: rgba(255,105,180,0.6); border-radius: 3px; }

        /* 追加：右键菜单样式 */
        .it-context-menu { position: absolute; top: 35px; right: 0; background: rgba(25, 25, 25, 0.95); border: 1px solid rgba(255, 105, 180, 0.5); border-radius: 8px; padding: 6px 0; min-width: 160px; display: none; flex-direction: column; box-shadow: 0 4px 20px rgba(0,0,0,0.6); z-index: 2147483647; }
        .it-menu-item { padding: 8px 15px; color: #fff; cursor: pointer; font-size: 13px; transition: background 0.2s; white-space: nowrap; }
        .it-menu-item:hover { background: rgba(255, 105, 180, 0.4); }
        .it-menu-desc { font-size: 10px; color: rgba(255, 255, 255, 0.5); display: block; margin-top: 2px; }
        .it-menu-sep { height: 1px; background: rgba(255, 255, 255, 0.1); margin: 4px 0; }

        /* 追加：设置面板面板 */
        .it-set-mask { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2147483647; backdrop-filter: blur(2px); }
        .it-set-box { background:#1e1e1e; border:1px solid #ff69b4; padding:20px; border-radius:12px; width:340px; color:#eee; font-family: sans-serif; }
        .it-set-box h3 { margin: 0 0 15px 0; color:#ff69b4; font-size:16px; border-bottom: 1px solid #333; padding-bottom: 10px; position: relative; padding-right: 30px; }
        .it-set-close { position: absolute; top: 0; right: 0; width: 24px; height: 24px; border: none; background: transparent; color: #ff69b4; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
        .it-set-close:hover { transform: scale(1.1); }
        .it-set-box label { display:block; margin: 10px 0 5px; font-size:12px; color:#bbb; }
        .it-set-box input { width:100%; background:#2a2a2a; border:1px solid #444; color:#fff; padding:8px; border-radius:4px; box-sizing:border-box; outline:none; }
        .it-set-btn { background:#ff69b4; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; width:100%; margin-top:20px; font-weight:bold; }

        /* 全局加载提示 */
        .it-global-loading { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(30, 30, 30, 0.95); border: 2px solid #ff69b4; border-radius: 12px; padding: 30px 40px; color: #fff; font-size: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; gap: 15px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); }
        .it-loading-spinner { width: 40px; height: 40px; border: 4px solid rgba(255, 105, 180, 0.3); border-top-color: #ff69b4; border-radius: 50%; animation: it-spin 1s linear infinite; }
        @keyframes it-spin { to { transform: rotate(360deg); } }
    `);

    const processedImages = new WeakSet();
    let lastRightClickedImage = null; // 记录最后右键点击的图片
    let globalLoadingEl = null; // 全局加载提示元素

    // 显示全局加载提示
    function showGlobalLoading(text = '正在翻译中，请稍候...') {
        if (globalLoadingEl) return;
        globalLoadingEl = document.createElement('div');
        globalLoadingEl.className = 'it-global-loading';
        globalLoadingEl.innerHTML = `<div class="it-loading-spinner"></div><div>${text}</div>`;
        document.body.appendChild(globalLoadingEl);
    }

    // 隐藏全局加载提示
    function hideGlobalLoading() {
        if (globalLoadingEl) {
            globalLoadingEl.remove();
            globalLoadingEl = null;
        }
    }

    // ================= [3. 强力 JSON 修复引擎] =================

    /**
     * 修复并解析 LLM 输出的 JSON
     * 使用多阶段修复策略
     */
    function repairAndParse(text) {
        console.log('[1. API 原始输出]', text);
        try {
            const raw = JSON.parse(text);
            let content = raw.choices[0].message.content;
            console.log('[2. 提取的 content]', content);

            // 阶段1: 预处理 - 清理 markdown 代码块和常见问题
            content = content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '');

            // 移除字段值中间插入的非法字符串
            content = content.replace(/,\s*"[^"]{10,}",?\s*\n/g, ',\n');
            content = content.replace(/("[\w\s]+"\s*:\s*"[^"]*")\s*,\s*"[^"]{10,}"\s*,/g, '$1,');

            console.log('[3. 预处理后的 JSON]', content);

            // 阶段2: 尝试直接解析
            try {
                const data = JSON.parse(content);
                if (data && data.texts) {
                    console.log('[4. 直接解析成功]', data);
                    return data;
                }
            } catch (e) {
                console.log('[4. 直接解析失败，尝试增强修复]', e.message);
            }

            // 阶段3: 使用增强的修复引擎（作为后备）
            const result = enhancedJsonRepair(content);
            if (result && result.texts) {
                console.log('[5. 增强修复成功]', result);
                return result;
            }

            console.error('[6. 所有修复方法均失败]');
            return null;
        } catch (e) {
            console.error('[解析彻底失败]', e);
            return null;
        }
    }

    /**
     * 增强的 JSON 修复引擎
     * 参考 json-repair-js 实现，使用递归下降解析器
     */
    function enhancedJsonRepair(jsonStr) {
        const WHITESPACE = new Set([0x20, 0x09, 0x0A, 0x0D]); // space, tab, newline, return
        let index = 0;
        const contextStack = [];

        function skipWhitespace() {
            while (index < jsonStr.length) {
                const code = jsonStr.charCodeAt(index);
                if (!WHITESPACE.has(code)) break;
                index++;
            }
        }

        function peek() {
            return jsonStr[index];
        }

        // 查找 JSON 开始位置，跳过 markdown 代码块
        let foundJson = false;

        while (index < jsonStr.length) {
            const char = peek();

            // 处理 markdown 代码块
            if (char === '`') {
                if (jsonStr.slice(index, index + 3) === '```') {
                    // 跳过整个 ``` 代码块标记
                    index += 3;
                    // 继续跳过直到换行
                    while (index < jsonStr.length && jsonStr[index] !== '\n') {
                        index++;
                    }
                    continue;
                }
                // 跳过单个反引号
                index++;
                continue;
            }

            // 查找 JSON 开始
            if (char === '{' || char === '[') {
                foundJson = true;
                break;
            }

            index++;
        }

        if (!foundJson) {
            console.error('[JSON 修复] 未找到有效的 JSON 开始标记');
            return null;
        }

        function parseValue() {
            skipWhitespace();
            const char = peek();

            if (!char) return null;
            if (char === '{') return parseObject();
            if (char === '[') return parseArray();
            if (char === '"' || char === "'") return parseString();
            if (/[-0-9]/.test(char)) return parseNumber();
            if (/[a-zA-Z]/.test(char)) return parseUnquotedString();

            index++;
            return null;
        }

        function parseObject() {
            const obj = {};
            index++; // skip {

            while (index < jsonStr.length) {
                skipWhitespace();

                if (peek() === '}') {
                    index++;
                    break;
                }

                // 解析键
                contextStack.push('OBJECT_KEY');
                const key = parseString() || parseUnquotedString();
                contextStack.pop();

                if (!key) break;

                skipWhitespace();

                // 处理缺失的冒号
                if (peek() !== ':') {
                    console.log('[JSON 修复] 自动添加缺失的冒号');
                } else {
                    index++; // skip :
                }

                skipWhitespace();

                // 解析值
                contextStack.push('OBJECT_VALUE');
                const value = parseValue();
                contextStack.pop();

                if (key && value !== undefined) {
                    obj[key] = value;
                }

                skipWhitespace();

                // 处理逗号
                if (peek() === ',') {
                    index++;
                }
            }

            return obj;
        }

        function parseArray() {
            const arr = [];
            index++; // skip [
            contextStack.push('ARRAY');

            while (index < jsonStr.length) {
                skipWhitespace();

                if (peek() === ']') {
                    index++;
                    break;
                }

                const value = parseValue();
                if (value !== undefined) {
                    arr.push(value);
                }

                skipWhitespace();

                // 处理逗号
                if (peek() === ',') {
                    index++;
                }
            }

            contextStack.pop();
            return arr;
        }

        function parseString() {
            let char = peek();
            const isQuoted = char === '"' || char === "'";
            let stringAcc = '';

            // 跳过前导空白
            while (char && /\s/.test(char)) {
                index++;
                char = peek();
            }

            if (isQuoted) {
                const quote = char;
                index++; // skip opening quote

                while (index < jsonStr.length) {
                    char = peek();

                    if (char === quote) {
                        index++; // skip closing quote
                        break;
                    }

                    // 处理转义字符
                    if (char === '\\' && index < jsonStr.length - 1) {
                        const nextChar = jsonStr[index + 1];
                        if (nextChar === quote) {
                            stringAcc += quote;
                            index += 2;
                            continue;
                        }
                    }

                    stringAcc += char;
                    index++;
                }
            } else {
                // 对于无引号字符串，收集直到遇到分隔符
                while (index < jsonStr.length) {
                    char = peek();

                    if ([',', '}', ']', ':'].includes(char)) {
                        break;
                    } else if (/\s/.test(char)) {
                        // 处理单词之间的空白
                        if (stringAcc && index < jsonStr.length - 1) {
                            const nextChar = jsonStr[index + 1];
                            if (!/[,}\]:]/.test(nextChar)) {
                                stringAcc += ' ';
                            }
                        }
                    } else {
                        stringAcc += char;
                    }

                    index++;
                }
            }

            const trimmed = stringAcc.trim();

            // 为对象值和数组元素转换类型
            const currentContext = contextStack[contextStack.length - 1];
            if (!isQuoted && (currentContext === 'OBJECT_VALUE' || currentContext === 'ARRAY')) {
                return convertStringToType(trimmed);
            }

            return trimmed;
        }

        function parseNumber() {
            let numStr = '';

            while (index < jsonStr.length) {
                const char = peek();
                if (!/[-0-9.eE]/.test(char)) break;
                numStr += char;
                index++;
            }

            const num = Number(numStr);
            return isNaN(num) ? numStr : num;
        }

        function parseUnquotedString() {
            let str = '';

            while (index < jsonStr.length) {
                const char = peek();
                if ([',', '}', ']', ':'].includes(char) || /\s/.test(char)) break;
                str += char;
                index++;
            }

            // 转换类型
            return convertStringToType(str.trim());
        }

        function convertStringToType(str) {
            if (!str || str === '') return null;

            // 尝试数字
            const num = Number(str);
            if (!isNaN(num)) return num;

            // 尝试布尔值/null
            const lower = str.toLowerCase();
            if (lower === 'true') return true;
            if (lower === 'false') return false;
            if (lower === 'null') return null;

            return str;
        }

        try {
            const result = parseValue();
            console.log('[JSON 修复成功]', result);
            return result;
        } catch (e) {
            console.error('[JSON 修复失败]', e);
            return null;
        }
    }

    function smartWrapText(ctx, text, maxWidth) {
        const lines = [];
        text.split('\n').forEach(para => {
            if (!para) { lines.push(''); return; }
            let curr = '';
            para.split('').forEach(char => {
                if (ctx.measureText(curr + char).width > maxWidth) { lines.push(curr); curr = char; } else { curr += char; }
            });
            if (curr) lines.push(curr);
        });
        return lines;
    }

    // ================= [4. 翻译引擎] (追加 mode) =================

    async function doTranslate(img, btn, wrapper, mode = 'auto', useGlobalLoading = false) {
        if (btn && btn.classList.contains('it-loading')) return;

        // 如果是自动模式且全局开启了文字翻译，则强制切换到文字翻译
        if (mode === 'auto' && isAlwaysTextMode()) {
            mode = 'text_only';
        }

        if (btn) {
            btn.classList.add('it-loading');
            btn.innerHTML = '❤';
        }

        // 显示全局 loading
        if (useGlobalLoading) {
            showGlobalLoading();
        }

        try {
            const blob = await new Promise((res, rej) => {
                GM_xmlhttpRequest({
                    method: 'GET', url: img.src, responseType: 'blob',
                    onload: r => {
                        const reader = new FileReader();
                        reader.onloadend = () => res(reader.result);
                        reader.readAsDataURL(r.response);
                    }, onerror: rej
                });
            });

            // 原有 Prompt 绝对不动
            const prompt = `请识别图片文字并翻译成简体中文。
要求：
1. 使用归一化坐标(0-1000)。
2. **严禁保留英文或空格**。将"HAH"等拟声词翻译为"哈"。
3. 翻译长度应与原文视觉长度匹配，用\n换行，你的换行应该基于原版类似的长度。
4. 智能判断字号(small/medium/large)。
5. **坐标格式要求**：每个文本必须包含 x, y, width, height 四个数值，不要使用数组格式。
6. **文本合并要求**：同一行或相邻的文本片段应合并为一个整体，避免过度拆分。
7. **只输出纯JSON**，格式：{"texts":[{"x":100,"y":100,"width":50,"height":20,"text":"中文","size":"medium"}]}。`;

            const res = await new Promise((resolve, reject) => {
                // 构建基础请求体
                let requestBody = {
                    model: CONFIG.model,
                    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: blob } }] }],
                    temperature: 0.1
                };

                // 如果有额外参数，合并到请求体中
                if (CONFIG.extraBody) {
                    try {
                        const extraParams = JSON.parse(CONFIG.extraBody);
                        requestBody = { ...requestBody, ...extraParams };
                    } catch (e) {
                        console.error('[额外参数解析失败]', e);
                    }
                }

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: CONFIG.apiBaseUrl + "/chat/completions",
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.apiKey}` },
                    data: JSON.stringify(requestBody),
                    onload: resolve, onerror: reject
                });
            });

            const data = repairAndParse(res.responseText);
            if (!data) throw new Error("JSON 解析及修复均失败");

            if (mode === 'text_only') {
                if (useGlobalLoading) {
                    hideGlobalLoading();
                    showTextOnlyResult(data.texts.map(t => t.text).join('\n\n'));
                } else {
                    renderTextPopup(wrapper, data.texts.map(t => t.text).join('\n\n'), btn);
                }
                return;
            }

            const offImg = new Image();
            await new Promise(r => { offImg.onload = r; offImg.src = blob; });
            const cvs = document.createElement('canvas');
            cvs.width = offImg.naturalWidth; cvs.height = offImg.naturalHeight;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(offImg, 0, 0);

            data.texts.forEach(item => {
                const w = (item.width * cvs.width) / 1000, h = (item.height * cvs.height) / 1000;
                const x = (item.x * cvs.width) / 1000, y = (item.y * cvs.height) / 1000;
                let fs = Math.max(10, Math.floor(Math.min((cvs.width / 800) * CONFIG.fontSize * (CONFIG.sizeMapping[item.size] || 1.0), h * 0.9)));
                ctx.font = `bold ${fs}px "Microsoft YaHei"`;
                let lines = smartWrapText(ctx, item.text, w);
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                lines.forEach((line, i) => {
                    const ly = y + (h / 2) - ((lines.length - 1) * fs * 0.6) + (i * fs * 1.2);
                    ctx.strokeStyle = CONFIG.strokeColor; ctx.lineWidth = CONFIG.strokeWidth;
                    ctx.strokeText(line, x + w / 2, ly);
                    ctx.fillStyle = CONFIG.textColor; ctx.fillText(line, x + w / 2, ly);
                });
            });

            const dataUrl = cvs.toDataURL('image/jpeg', 0.95);

            if (useGlobalLoading) {
                hideGlobalLoading();
                img.src = dataUrl;
            } else {
                const testImg = new Image();
                testImg.onload = () => { img.src = dataUrl; wrapper.remove(); };
                testImg.onerror = () => renderTextPopup(wrapper, data.texts.map(t => t.text).join('\n\n'), btn);
                testImg.src = dataUrl;
            }

        } catch (e) {
            if (useGlobalLoading) {
                hideGlobalLoading();
                alert('翻译失败：' + (e.message || '未知错误'));
            } else if (btn) {
                btn.innerHTML = '✕';
                btn.classList.remove('it-loading');
                setTimeout(() => { btn.innerHTML = '译'; }, 2000);
            }
        }
    }

    // 显示纯文字翻译结果
    function showTextOnlyResult(content) {
        const mask = document.createElement('div');
        mask.className = 'it-set-mask';
        mask.innerHTML = `<div class="it-set-box" style="width: 500px; max-height: 80vh; overflow: auto;"><h3>翻译结果<button class="it-set-close" onclick="this.closest('.it-set-mask').remove()">✕</button></h3><div style="white-space: pre-wrap; line-height: 1.8; font-size: 14px;">${content}</div></div>`;
        document.body.appendChild(mask);
        mask.onclick = (e) => {
            if (e.target === mask) mask.remove();
        };
    }

    function renderTextPopup(wrapper, content, btn) {
        btn.innerHTML = '文'; btn.classList.remove('it-loading');
        if (!wrapper.querySelector('.it-popup')) {
            const popup = document.createElement('div');
            popup.className = 'it-popup';

            const contentDiv = document.createElement('div');
            contentDiv.textContent = content;
            popup.appendChild(contentDiv);

            const closeBtn = document.createElement('button');
            closeBtn.className = 'it-popup-close';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                popup.remove();
            };
            popup.appendChild(closeBtn);

            popup.addEventListener('wheel', e => e.stopPropagation());
            wrapper.appendChild(popup);
        }
    }

    // ================= [5. 追加：设置与菜单逻辑] =================

    function openSettings() {
        const mask = document.createElement('div');
        mask.className = 'it-set-mask';
        mask.innerHTML = `<div class="it-set-box"><h3>图片翻译配置<button class="it-set-close" id="it-close">✕</button></h3><label>API 接口</label><input type="text" id="it-url" value="${CONFIG.apiBaseUrl}"><label>模型</label><input type="text" id="it-model" value="${CONFIG.model}"><label>密钥</label><input type="password" id="it-key" value="${CONFIG.apiKey}"><label>额外参数 (JSON格式)</label><input type="text" id="it-extra" placeholder='{"enable_thinking": false}' value="${CONFIG.extraBody}"><button class="it-set-btn" id="it-save">保存并刷新</button></div>`;
        document.body.appendChild(mask);
        document.getElementById('it-close').onclick = () => mask.remove();
        document.getElementById('it-save').onclick = () => {
            const extraBodyValue = document.getElementById('it-extra').value.trim();
            if (extraBodyValue) {
                try {
                    JSON.parse(extraBodyValue);
                } catch (e) {
                    alert('额外参数必须是有效的 JSON 格式！');
                    return;
                }
            }
            GM_setValue('apiBaseUrl', document.getElementById('it-url').value.trim());
            GM_setValue('model', document.getElementById('it-model').value.trim());
            GM_setValue('apiKey', document.getElementById('it-key').value.trim());
            GM_setValue('extraBody', extraBodyValue);
            location.reload();
        };
    }

    function setupImage(img) {
        if (!img || processedImages.has(img)) return;

        // 检查是否在当前网站隐藏图标
        if (isHideIcon()) return;

        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;

        // 改进的图片检测：检查尺寸和面积
        if (w < CONFIG.minImageSize || h < CONFIG.minImageSize) return;
        if ((w * h) < CONFIG.minImageArea) return;

        processedImages.add(img);
        const wrapper = document.createElement('div');
        wrapper.className = 'it-wrapper';
        const btn = document.createElement('div');
        btn.className = 'it-btn'; btn.innerHTML = '译';

        const menu = document.createElement('div');
        menu.className = 'it-context-menu';

        const updateMenu = () => {
            const alwaysText = isAlwaysTextMode();
            const hideIcon = isHideIcon();
            menu.innerHTML = `
                <div class="it-menu-item" data-action="text">📝 文字翻译
                    <span class="it-menu-desc">直接点击翻译失败请使用</span>
                </div>
                <div class="it-menu-item" data-action="toggle_always">${alwaysText ? '🔓 解除一律文字翻译' : '🔒 一律文字翻译此网站'}</div>
                <div class="it-menu-item" data-action="toggle_hide_icon">${hideIcon ? '👁 在此网站显示图标' : '👁‍🗨 在此网站不显示图标'}
                    <span class="it-menu-desc">隐藏后可通过浏览器菜单启用</span>
                </div>
                <div class="it-menu-sep"></div>
                <div class="it-menu-item" data-action="config">⚙ 设置</div>
            `;
        };

        updateMenu();
        wrapper.append(btn, menu);
        document.body.appendChild(wrapper);

        let hideTimer;
        const show = () => { clearTimeout(hideTimer); const r = img.getBoundingClientRect(); wrapper.style.top = `${r.top + 5}px`; wrapper.style.left = `${r.right - 45}px`; wrapper.style.display = 'flex'; };
        const hide = () => { hideTimer = setTimeout(() => { if (!btn.classList.contains('it-loading') && menu.style.display !== 'flex') wrapper.style.display = 'none'; }, 300); };

        img.addEventListener('mouseenter', show);
        img.addEventListener('mouseleave', hide);
        wrapper.addEventListener('mouseenter', show);
        wrapper.addEventListener('mouseleave', hide);

        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = 'none'; doTranslate(img, btn, wrapper, 'auto'); };
        btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); updateMenu(); menu.style.display = (menu.style.display === 'flex' ? 'none' : 'flex'); };

        // 图片右键菜单：记录最后右键点击的图片
        img.addEventListener('contextmenu', (e) => {
            lastRightClickedImage = img;
        });

        menu.onclick = (e) => {
            e.stopPropagation();
            const action = e.target.closest('.it-menu-item')?.dataset.action;
            if (action === 'text') doTranslate(img, btn, wrapper, 'text_only');
            else if (action === 'toggle_always') {
                GM_setValue('always_text_' + location.hostname, !isAlwaysTextMode());
                updateMenu();
            }
            else if (action === 'toggle_hide_icon') {
                GM_setValue('hide_icon_' + location.hostname, !isHideIcon());
                updateMenu();
                if (isHideIcon()) {
                    wrapper.remove();
                }
            }
            else if (action === 'config') openSettings();
            menu.style.display = 'none';
        };

        window.addEventListener('scroll', () => { wrapper.style.display = 'none'; menu.style.display = 'none'; }, { passive: true });
    }

    const io = new IntersectionObserver((es) => { es.forEach(e => { if (e.isIntersecting) { setupImage(e.target); io.unobserve(e.target); } }); }, { rootMargin: '100px' });
    const scan = () => { document.querySelectorAll('img').forEach(i => io.observe(i)); };
    const observer = new MutationObserver(m => { if (m.some(r => r.addedNodes.length > 0)) scan(); });
    scan();
    observer.observe(document.body, { childList: true, subtree: true });

    // ================= [6. 浏览器右键菜单注册] =================

    // 翻译图片（自动模式）
    GM_registerMenuCommand('📷 翻译图片', () => {
        let targetImg = lastRightClickedImage;
        if (!targetImg) {
            const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
                const w = img.naturalWidth > 0 ? img.naturalWidth : img.width;
                const h = img.naturalHeight > 0 ? img.naturalHeight : img.height;
                const rect = img.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            if (imgs.length > 0) targetImg = imgs[0];
        }

        if (targetImg) {
            doTranslate(targetImg, null, null, 'auto', true);
        }
    });

    // 翻译图片（文字模式）
    GM_registerMenuCommand('📝 翻译图片（文字模式）', () => {
        let targetImg = lastRightClickedImage;
        if (!targetImg) {
            const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
                const w = img.naturalWidth > 0 ? img.naturalWidth : img.width;
                const h = img.naturalHeight > 0 ? img.naturalHeight : img.height;
                const rect = img.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            if (imgs.length > 0) targetImg = imgs[0];
        }

        if (targetImg) {
            doTranslate(targetImg, null, null, 'text_only', true);
        }
    });

    // 切换图标显示/隐藏
    GM_registerMenuCommand('👁‍🗨 切换图标显示/隐藏', () => {
        const hideIcon = isHideIcon();
        GM_setValue('hide_icon_' + location.hostname, !hideIcon);
        if (hideIcon) {
            alert('已启用图标显示，刷新页面后生效');
        } else {
            alert('已隐藏图标，刷新页面后生效。\n您可以通过浏览器菜单重新启用图标。');
        }
    });

    // 打开设置面板
    GM_registerMenuCommand('⚙ 打开设置面板', () => {
        openSettings();
    });

})();
