document.addEventListener('DOMContentLoaded', () => {
    // --- تعريف عناصر DOM (كما هي) ---
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const fileInput = document.getElementById('fileInput');
    const fileNameDisplay = document.getElementById('fileName');
    const chatMessagesContainer = document.getElementById('chat-messages');
    const historyList = document.getElementById('historyList');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const modelSelector = document.getElementById('modelSelector');
    const clearCurrentChatBtn = document.getElementById('clearCurrentChatBtn');
    const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
    const newChatBtn = document.getElementById('newChatBtn');

    // --- قائمة النماذج (مُحدّثة لتشمل OpenRouter بشكل صحيح) ---
    const AVAILABLE_MODELS = [
        { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Puter Native)" },
        { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet (Puter Native)" },
        // نماذج OpenRouter (أمثلة - استبدل/أضف من توثيق Puter/OpenRouter)
        { id: "openrouter:meta-llama/llama-3.1-8b-instruct", name: "OR: Llama 3.1 8B" },
        { id: "openrouter:google/gemini-pro-1.5", name: "OR: Gemini Pro 1.5" },
        { id: "openrouter:openai/gpt-4o-mini", name: "OR: GPT-4o Mini" },
    ];

    let chatHistory = [];
    let currentChatId = null;
    let currentFile = null;
    const USER_ROLE = "user";
    const ASSISTANT_ROLE = "assistant";

    function initializeApp() {
        if (typeof puter === 'undefined' || typeof puter.ai === 'undefined' || typeof puter.ai.chat !== 'function') {
            console.error("Puter.js library not loaded!");
            displayCriticalError("❌ خطأ حرج: فشل تحميل مكتبة الذكاء الاصطناعي.");
            disableInputs(); return;
        }
        if (typeof hljs !== 'undefined') {
            marked.setOptions({
                highlight: (code, lang) => {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                }
            });
        }

        populateModelSelector();
        loadHistoryFromLocalStorage();
        renderHistorySidebar();

        if (chatHistory.length > 0 && chatHistory[0]?.id) { // تحقق من وجود ID
            loadChat(chatHistory[0].id);
        } else {
            createNewChat();
        }

        userInput.addEventListener('keypress', handleKeyPress);
        userInput.addEventListener('input', autoResizeTextarea);
        sendButton.addEventListener('click', handleSendMessage);
        fileInput.addEventListener('change', handleFileSelect);
        clearCurrentChatBtn.addEventListener('click', confirmClearCurrentChatDisplay); // ✨ استخدام تأكيد
        clearAllHistoryBtn.addEventListener('click', confirmClearAllHistory);
        newChatBtn.addEventListener('click', () => {
            if (loadingIndicator.style.display !== 'flex') createNewChat();
        });
        modelSelector.addEventListener('change', updateWelcomeMessageBasedOnModelIfEmpty);

        // لا تستدعي addWelcomeMessage هنا مباشرة، دع createNewChat أو loadChat تعالجها.
        updateSendButtonState();
    }

    function disableInputs() { /* ... كما هي ... */ }
    function displayCriticalError(message) { /* ... كما هي ... */ }

    function populateModelSelector() {
        modelSelector.innerHTML = '';
        if (AVAILABLE_MODELS.length === 0) {
            const option = document.createElement('option');
            option.value = ""; option.textContent = "لا نماذج"; option.disabled = true;
            modelSelector.appendChild(option); return;
        }
        AVAILABLE_MODELS.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id; option.textContent = model.name;
            modelSelector.appendChild(option);
        });
        const defaultModel = AVAILABLE_MODELS.find(m => m.id === "claude-3-7-sonnet") || AVAILABLE_MODELS[0];
        if (defaultModel) modelSelector.value = defaultModel.id;
    }

    function addWelcomeMessage() {
        if (AVAILABLE_MODELS.length === 0 || !modelSelector.options || modelSelector.options.length === 0) {
            addMessageToDisplay([{ type: "text", text: "يرجى تكوين النماذج." }], ASSISTANT_ROLE, false, true);
            return;
        }
        const selectedModelName = modelSelector.options[modelSelector.selectedIndex]?.text || "النموذج";
        addMessageToDisplay([{ type: "text", text: `أنا ${selectedModelName}. كيف أساعدك؟` }], ASSISTANT_ROLE, false, true, true /* isWelcome=true, noAnimation=true */);
    }
    
    function updateWelcomeMessageBasedOnModelIfEmpty() {
        const currentChat = chatHistory.find(chat => chat.id === currentChatId);
        if (currentChat && (currentChat.messages.length === 0 || (currentChat.messages.length === 1 && currentChat.messages[0].isWelcome))) {
            chatMessagesContainer.innerHTML = '';
            addWelcomeMessage();
        }
    }

    function autoResizeTextarea() { /* ... كما هي ... */ }
    function updateSendButtonState() { /* ... كما هي ... */ }

    async function handleSendMessage() {
        const userText = userInput.value.trim();
        if (!userText && !currentFile) return;

        const selectedModel = modelSelector.value;
        if (!selectedModel || typeof selectedModel !== 'string' || selectedModel.trim() === "" || AVAILABLE_MODELS.length === 0) {
            addMessageToDisplay([{ type: "text", text: "❌ يرجى تحديد نموذج." }], ASSISTANT_ROLE, true);
            return;
        }
        
        const userMessageDisplayContent = [];
        if (userText) userMessageDisplayContent.push({ type: "text", text: userText });
        if (currentFile) {
            userMessageDisplayContent.push({ 
                type: currentFile.type.startsWith("image/") ? "image_placeholder" : "file_placeholder", 
                file_name: currentFile.name, media_type: currentFile.type 
            });
        }
        
        const userMessageApiContentInitial = [];
        if (userText) userMessageApiContentInitial.push({ type: "text", text: userText });
        
        const tempFileForApi = currentFile;
        addMessageToChatHistory(userMessageDisplayContent, USER_ROLE, tempFileForApi?.name, userMessageApiContentInitial);

        userInput.value = ''; clearFileInput(); autoResizeTextarea();
        loadingIndicator.style.display = 'flex'; updateSendButtonState();

        try {
            const currentChat = chatHistory.find(chat => chat.id === currentChatId);
            const conversationContextForAPI = currentChat ? 
                currentChat.messages.slice(0, -1) // لا تشمل رسالة المستخدم الحالية هنا
                    .filter(msg => !msg.isError) // لا ترسل رسائل الخطأ كسياق
                    .map(msg => ({ role: msg.role, content: msg.apiContent })) 
                : [];

            let finalUserMessageApiContent = [...userMessageApiContentInitial];
            if (tempFileForApi && tempFileForApi.type.startsWith("image/")) {
                // دعم الصور يختلف. سنفترض أن Claude الأصلي يدعمها جيدًا.
                if (!selectedModel.startsWith("openrouter:")) {
                    const base64Data = await readFileAsBase64(tempFileForApi);
                    finalUserMessageApiContent.push({
                        type: "image", source: {
                            type: "base64", media_type: tempFileForApi.type, data: base64Data.split(',')[1]
                        }
                    });
                } else {
                    finalUserMessageApiContent.push({ type: "text", text: `(ملاحظة: صورة ${tempFileForApi.name} مرفقة. دعم الصور عبر OpenRouter يعتمد على النموذج.)` });
                }
            } else if (tempFileForApi) {
                 finalUserMessageApiContent.push({ type: "text", text: `(ملف مرفق: ${tempFileForApi.name})` });
            }
            
            if (currentChat && currentChat.messages.length > 0) { // تحديث apiContent للرسالة الأخيرة
                currentChat.messages[currentChat.messages.length - 1].apiContent = finalUserMessageApiContent;
            }

            const messagesForAPI = [...conversationContextForAPI, { role: USER_ROLE, content: finalUserMessageApiContent }];
            
            console.log("Sending to API:", selectedModel, JSON.stringify(messagesForAPI, null, 2));
            const response = await puter.ai.chat(messagesForAPI, { model: selectedModel });
            console.log("Raw AI Response from Puter:", response);

            let assistantResponseDisplayContent, assistantResponseApiContent;
            let responseText = "";

            if (selectedModel.startsWith("openrouter:")) {
                if (typeof response === 'string') {
                    responseText = response;
                } else if (response?.choices?.[0]?.message?.content) { // صيغة OpenAI الأكثر شيوعًا
                    responseText = response.choices[0].message.content;
                } else if (response?.message?.content?.[0]?.text) { // احتياطي
                    responseText = response.message.content[0].text;
                } else if (typeof response === 'object' && response !== null) {
                    responseText = response.text || response.content || JSON.stringify(response);
                    if (typeof responseText !== 'string') responseText = JSON.stringify(response);
                } else {
                     responseText = "❌ صيغة رد OpenRouter غير متوقعة.";
                     console.error("Unexpected OpenRouter response structure:", response);
                }
            } else { // نماذج Claude الأصلية أو غيرها
                if (response?.message?.content?.[0]?.text) {
                    responseText = response.message.content[0].text;
                } else if (response?.content && Array.isArray(response.content) && response.content[0]?.type === 'text') {
                    responseText = response.content.map(b => b.text).join('\n');
                } else {
                    responseText = "❌ صيغة الرد من النموذج غير متوقعة.";
                    console.error("Unexpected native model response structure:", response);
                }
            }

            assistantResponseDisplayContent = [{ type: "text", text: responseText }];
            assistantResponseApiContent = [{ type: "text", text: responseText }];

            addMessageToChatHistory(assistantResponseDisplayContent, ASSISTANT_ROLE, null, assistantResponseApiContent);

        } catch (error) {
            console.error("Error in handleSendMessage:", error);
            let errorMsgText = "حدث خطأ.";
            if (error?.error?.message) errorMsgText = error.error.message;
            else if (error?.response?.data?.error?.message) errorMsgText = error.response.data.error.message;
            else if (error?.message) errorMsgText = error.message;
            else if (typeof error === 'string') errorMsgText = error;
            else try { errorMsgText = JSON.stringify(error); } catch (e) { /* ignore */ }
            
            addMessageToChatHistory(
                [{ type: "text", text: `❌ خطأ: ${errorMsgText}` }], ASSISTANT_ROLE, 
                null, [{ type: "text", text: `Error: ${errorMsgText}` }], true
            );
        } finally {
            loadingIndicator.style.display = 'none'; updateSendButtonState();
        }
    }

    function addMessageToChatHistory(displayContent, role, fileName = null, apiContent = null, isError = false) {
        const currentChat = chatHistory.find(chat => chat.id === currentChatId);
        if (!currentChat) return;

        let finalApiContent = apiContent;
        if (!finalApiContent) {
            if (Array.isArray(displayContent)) {
                finalApiContent = displayContent.map(block => (block.type === "text" ? { type: "text", text: block.text } : null)).filter(Boolean);
                if (finalApiContent.length === 0 && role === USER_ROLE && fileName) {
                    finalApiContent.push({type: "text", text: `(ملف: ${fileName})`});
                }
            } else if (typeof displayContent === 'string') {
                finalApiContent = [{ type: "text", text: displayContent }];
            } else {
                finalApiContent = [{ type: "text", text: "(محتوى غير نصي)"}];
            }
        }
        
        currentChat.messages.push({ 
            role, displayContent, apiContent: finalApiContent, 
            timestamp: new Date().toISOString(), fileName, isError,
            isWelcome: (role === ASSISTANT_ROLE && currentChat.messages.length === 0 && !isError) // تحديد رسالة الترحيب
        });
        
        if (role === USER_ROLE && currentChat.messages.length === (currentChat.messages[0]?.isWelcome ? 2 : 1) && displayContent.some(c => c.type === 'text' && c.text)) {
            const firstTextContent = displayContent.find(c => c.type === 'text').text;
            currentChat.title = generateChatTitle(firstTextContent);
        }
        
        saveHistoryToLocalStorage();
        renderHistorySidebar(); // قد يغير العنوان
        renderCurrentChatMessages(); // يعيد رسم كل شيء بما في ذلك الرسالة الجديدة
    }

    // ✨ noAnimation للمعلمات لتجنب تكرار الأنيميشن لرسائل الترحيب عند تحميل المحادثة ✨
    function addMessageToDisplay(displayContentBlocks, role, isError = false, isWelcome = false, noAnimation = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', role);
        if (isError) messageDiv.classList.add('error');
        if (isWelcome) messageDiv.classList.add('welcome');
        if (noAnimation || isWelcome) messageDiv.style.animation = 'none'; // تجنب الأنيميشن للترحيب أو عند الطلب

        const messageContentDiv = document.createElement('div');
        messageContentDiv.classList.add('message-content');
        
        let hasCodeBlockInMessage = false;

        if (Array.isArray(displayContentBlocks)) {
            displayContentBlocks.forEach(block => {
                if (block.type === "text" && block.text) {
                    const htmlContent = marked.parse(block.text);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmlContent;
                    
                    tempDiv.querySelectorAll('pre').forEach(preElement => {
                        hasCodeBlockInMessage = true;
                        const codeText = preElement.querySelector('code')?.innerText || preElement.innerText;
                        const copyBtn = document.createElement('button');
                        copyBtn.classList.add('copy-code-btn');
                        copyBtn.innerHTML = 'نسخ الكود 📋';
                        copyBtn.title = "نسخ الكود";
                        copyBtn.onclick = () => {
                            navigator.clipboard.writeText(codeText).then(() => {
                                copyBtn.innerHTML = 'تم النسخ ✅';
                                setTimeout(() => { copyBtn.innerHTML = 'نسخ الكود 📋'; }, 2000);
                            }).catch(err => console.error('Failed to copy code: ', err));
                        };
                        preElement.insertBefore(copyBtn, preElement.firstChild);
                    });
                    
                    Array.from(tempDiv.childNodes).forEach(child => {
                        messageContentDiv.appendChild(child.cloneNode(true));
                    });

                } else if ((block.type === "image_placeholder" || block.type === "file_placeholder") && block.file_name) {
                    /* ... كما هي ... */
                    const pFile = document.createElement('p'); /* ... */ pFile.innerHTML = `<em>ملف: ${block.file_name} <small>(${block.media_type || ''})</small></em>`; messageContentDiv.appendChild(pFile);
                } else if (block.type === "unknown" && block.data) {
                    /* ... كما هي ... */
                    const pUnknown = document.createElement('p'); pUnknown.textContent = `[بيانات غير معروفة: ${JSON.stringify(block.data)}]`; messageContentDiv.appendChild(pUnknown);
                }
            });
        }

        messageDiv.appendChild(messageContentDiv);
        chatMessagesContainer.appendChild(messageDiv);

        if (hasCodeBlockInMessage && typeof hljs !== 'undefined') {
            messageDiv.querySelectorAll('pre code').forEach((codeBlock) => {
                hljs.highlightElement(codeBlock);
            });
        }
        if (!noAnimation) { // فقط قم بالتمرير إذا لم تكن رسالة بدون انيميشن (مثل تحميل السجل)
             chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }

    function handleFileSelect(event) { /* ... كما هي ... */ }
    function clearFileInput() { /* ... كما هي ... */ }
    function readFileAsBase64(file) { /* ... كما هي ... */ }
    function generateChatTitle(text) { /* ... كما هي ... */ }

    function createNewChat() {
        const newChatId = `chat-${Date.now()}`;
        const newChat = { id: newChatId, title: "محادثة جديدة", messages: [], createdAt: new Date().toISOString() };
        chatHistory.unshift(newChat);
        currentChatId = newChatId;
        saveHistoryToLocalStorage();
        renderHistorySidebar();
        chatMessagesContainer.innerHTML = ''; // مسح أي شيء قبل عرض الترحيب
        addWelcomeMessage(); // ستعرض رسالة ترحيب جديدة
        userInput.value = ''; // مسح حقل الإدخال
        clearFileInput();
        userInput.focus();
        return newChatId;
    }
    
    function loadChat(chatId) {
        const chat = chatHistory.find(c => c.id === chatId);
        if (chat) {
            currentChatId = chatId;
            renderCurrentChatMessages(true); // ✨ true لـ noAnimation عند تحميل محادثة
            renderHistorySidebar();
            userInput.focus();
        } else {
            createNewChat();
        }
    }

    function renderCurrentChatMessages(noAnimationOnLoad = false) {
        chatMessagesContainer.innerHTML = '';
        const currentChat = chatHistory.find(chat => chat.id === currentChatId);
        if (currentChat && currentChat.messages.length > 0) {
            currentChat.messages.forEach(msg => {
                addMessageToDisplay(msg.displayContent, msg.role, msg.isError, msg.isWelcome, noAnimationOnLoad);
            });
        } else if (currentChatId) {
            addWelcomeMessage(); // عرض ترحيب إذا كانت المحادثة فارغة
        }
        // التمرير لأسفل بعد تحميل كل الرسائل إذا كان تحميل محادثة
        if (noAnimationOnLoad) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }
    
    // ✨ إصلاح مسح الدردشة ✨
    function confirmClearCurrentChatDisplay() {
        const currentChat = chatHistory.find(chat => chat.id === currentChatId);
        if (currentChat && currentChat.messages.length > 0 && !(currentChat.messages.length === 1 && currentChat.messages[0].isWelcome)) {
             if (confirm("هل أنت متأكد أنك تريد مسح رسائل هذه الدردشة؟ (لن يتم حذفها من السجل)")) {
                clearCurrentChatMessagesOnly();
            }
        } else {
            // لا تفعل شيئًا إذا كانت الدردشة فارغة بالفعل أو تحتوي فقط على رسالة ترحيب
        }
    }

    function clearCurrentChatMessagesOnly() {
        // هذه الدالة ستمسح الرسائل من العرض وتضيف رسالة "تم المسح"
        // ولكنها لن تعدل `currentChat.messages` في السجل
        chatMessagesContainer.innerHTML = '';
        addMessageToDisplay([{ type: "text", text: "تم مسح شاشة الدردشة. الرسائل لا تزال في السجل." }], ASSISTANT_ROLE, false, true, true);
        // إذا أردت مسح الرسائل من الكائن currentChat أيضًا (مع الاحتفاظ بها في localStorage)
        // يمكنك إضافة:
        // const currentChatObj = chatHistory.find(chat => chat.id === currentChatId);
        // if (currentChatObj) {
        //    currentChatObj.messages = []; // أو إضافة رسالة ترحيب فقط
        //    // لا تستدعي saveHistoryToLocalStorage() هنا إذا كنت لا تريد تغيير السجل
        // }
    }


    function renderHistorySidebar() { /* ... كما هي ... */ }
    function confirmDeleteHistoryItem(chatId) { /* ... كما هي ... */ }
    function deleteHistoryItem(chatId) { /* ... كما هي ... */ }
    function confirmClearAllHistory() { /* ... كما هي ... */ }
    function clearAllHistory() { /* ... كما هي ... */ }

    function saveHistoryToLocalStorage() {
        try { localStorage.setItem('aiChatAppHistory_v9_dynamic', JSON.stringify(chatHistory)); }
        catch (e) { console.error("Failed to save history:", e); }
    }
    function loadHistoryFromLocalStorage() {
        try {
            const storedHistory = localStorage.getItem('aiChatAppHistory_v9_dynamic');
            if (storedHistory) chatHistory = JSON.parse(storedHistory); else chatHistory = [];
        } catch (e) { console.error("Failed to load history:", e); chatHistory = []; }
    }

    function handleKeyPress(event) { /* ... كما هي ... */ }
    
    initializeApp();
});