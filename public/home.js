const socket = io();
const currentUserId = window.CURRENT_USER_ID;

let activeFriendId = null;
let isViewOnceMode = false;
let selectedMediaData = null;

let searchDebounceTimer = null;
let searchAbortController = null;
let activeChatAbortController = null;

const EDIT_TIME_LIMIT_MS = 15 * 60 * 1000; 
const MAX_FILE_SIZE_MB = 25; 

function initializeChatEngine() {
    try {
        if (currentUserId && socket.connected) {
            socket.emit('join', currentUserId);
        }

        const activeCard = document.querySelector('.friend-card.active, [data-friend-id].active');
        if (activeCard && activeCard.dataset.friendId) {
            activeFriendId = activeCard.dataset.friendId;
        }
    } catch (err) {
        console.error("Chat Engine Initialization Error:", err);
    }
}

socket.on('connect', () => {
    if (currentUserId) {
        socket.emit('join', currentUserId);
    }
});

function toggleViewOnceMode() {
    isViewOnceMode = !isViewOnceMode;
    const btn = document.getElementById('viewOnceToggleBtn');
    if (btn) {
        btn.style.color = isViewOnceMode ? '#3b82f6' : 'inherit';
        btn.style.background = isViewOnceMode ? 'rgba(59, 130, 246, 0.2)' : 'transparent';
    }
}

function compressImage(file, quality = 0.7, maxWidth = 1200) {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) return resolve(file);

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) {
                        resolve(file);
                        return;
                    }
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', quality);
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
}

function clearMediaSelection() {
    selectedMediaData = null;
    const fileInput = document.getElementById('mediaFileInput');
    if (fileInput) fileInput.value = '';

    const inputField = document.getElementById('messagePayloadInput');
    if (inputField) inputField.placeholder = "Type your message here...";

    const previewContainer = document.getElementById('mediaPreviewContainer');
    if (previewContainer) {
        previewContainer.style.display = 'none';
    }
}

async function handleFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        alert(`File size exceeds the ${MAX_FILE_SIZE_MB}MB limit. Please select a smaller file.`);
        clearMediaSelection();
        return;
    }

    const previewContainer = document.getElementById('mediaPreviewContainer');
    const previewName = document.getElementById('mediaPreviewName');
    const inputField = document.getElementById('messagePayloadInput');

    if (previewContainer && previewName) {
        previewName.innerText = `Uploading: ${file.name}...`;
        previewContainer.style.display = 'flex';
    }

    let fileToUpload = file;

    if (file.type.startsWith('image/')) {
        try {
            if (previewName) previewName.innerText = `Compressing & uploading: ${file.name}...`;
            fileToUpload = await compressImage(file, 0.7, 1200);
        } catch (e) {
            console.warn("Client-side image compression failed, sending original file.", e);
        }
    }

    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
        const response = await fetch('/user/upload-media', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        const mediaUrl = data.mediaUrl || data.url;
        
        let mediaType = data.mediaType;
        if (!mediaType) {
            if (file.type.startsWith('image/')) mediaType = 'image';
            else if (file.type.startsWith('video/')) mediaType = 'video';
            else mediaType = 'document';
        }

        if (response.ok && mediaUrl) {
            selectedMediaData = {
                mediaUrl: mediaUrl,
                mediaType: mediaType,
                fileName: data.fileName || file.name
            };

            if (previewName) {
                previewName.innerText = `Attached: ${file.name}`;
            }
            if (inputField) {
                inputField.placeholder = "Add an optional caption...";
            }
        } else {
            alert(data.error || "Failed to upload file.");
            clearMediaSelection();
        }
    } catch (err) {
        console.error("Upload error:", err);
        alert("Server error uploading file.");
        clearMediaSelection();
    }
}

function openViewOnceMedia(messageId, rawMediaUrl) {
    if (!messageId || !rawMediaUrl) return;

    const safeUrl = sanitizeUrl(rawMediaUrl);
    window.open(safeUrl, '_blank');

    socket.emit('message:view-once-open', {
        messageId,
        receiverId: activeFriendId
    });

    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        msgEl.innerHTML = `<div style="opacity: 0.6; font-style: italic; font-size: 13px;">📷 Opened Photo</div>`;
    }
}

function openConversationFromElement(el) {
    if (!el || !el.dataset) return;
    const friendId = el.dataset.friendId;
    const fullName = el.dataset.fullName;
    const avatarUrl = el.dataset.avatar;
    const username = el.dataset.username;
    openConversation(friendId, fullName, avatarUrl, username);
}

function backToSidebar() {
    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.remove('chat-active');
    }
}

async function openConversation(friendId, fullName, avatarUrl, username = '') {
    if (!friendId) return;
    activeFriendId = friendId;

    const headerEl = document.getElementById('activeChatHeader');
    
    if (headerEl) {
        headerEl.dataset.activeFriendId = friendId;
        headerEl.style.display = 'flex';
    }

    if (activeChatAbortController) {
        activeChatAbortController.abort();
    }
    activeChatAbortController = new AbortController();

    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.add('chat-active');
    }

    document.querySelectorAll('.friend-card, [data-friend-id]').forEach(c => {
        if (c.dataset.friendId === friendId) {
            c.classList.add('active');
        } else {
            c.classList.remove('active');
        }
    });
    
    const fallbackEl = document.getElementById('fallbackWelcome');
    const streamEl = document.getElementById('messageStream');
    const inputPanelEl = document.getElementById('activeChatInputPanel');

    if (fallbackEl) fallbackEl.style.display = 'none';
    if (streamEl) {
        streamEl.style.display = 'flex';
        streamEl.style.flexDirection = 'column';
    }
    if (inputPanelEl) inputPanelEl.style.display = 'flex';

    const chatNameEl = document.getElementById('activeChatName');
    const chatAvatarEl = document.getElementById('activeChatAvatar');
    const chatUsernameEl = document.getElementById('activeChatUsername');

    if (chatNameEl) chatNameEl.innerText = fullName || '';
    if (chatAvatarEl) chatAvatarEl.src = sanitizeUrl(avatarUrl) || '/images/default-avatar.png';
    if (chatUsernameEl) chatUsernameEl.innerText = username ? `@${username}` : '';

    if (streamEl) {
        streamEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-mute);">Loading conversation...</div>';
    }

    try {
        const response = await fetch(`/user/messages/${friendId}`, {
            signal: activeChatAbortController.signal
        });
        const data = await response.json();

        if (activeFriendId !== friendId) return;

        const blockBtn = document.getElementById('blockControlBtn');
        const isBlocked = (window.CURRENT_USER_BLOCKED_ARRAY || []).includes(friendId) || data.isBlocked;
        
        if (blockBtn) {
            blockBtn.title = isBlocked ? "Unblock User" : "Block User";
            blockBtn.onclick = () => manageUserAction(isBlocked ? '/user/unblock' : '/user/block', friendId);
        }

        const reportBtn = document.getElementById('reportControlBtn');
        if (reportBtn) {
            reportBtn.onclick = () => {
                const reason = prompt("Enter the reason for reporting this user:");
                if (reason) manageUserAction('/user/report', friendId, { reason });
            };
        }

        if (streamEl) {
            streamEl.innerHTML = "";
            const historyList = data.messages || data.history || [];

            if (historyList.length === 0) {
                streamEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-mute); font-size:13px;">No prior messages. Say hello!</div>';
            } else {
                historyList.forEach(msg => {
                    const isSelf = String(msg.senderId) === String(currentUserId);
                    const direction = isSelf ? 'sent' : 'received';
                    appendBubble(msg, direction);
                });
            }
        }
        scrollStreamToBottom();
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error("Error loading chat history:", err);
        if (streamEl) {
            streamEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--danger);">Failed to load chat history.</div>';
        }
    }
}

async function openDocumentPreview(rawUrl, fileName) {
    try {
        const safeUrl = sanitizeUrl(rawUrl);
        const isPdf = fileName.toLowerCase().endsWith('.pdf') || safeUrl.toLowerCase().includes('.pdf');
        if (isPdf) {
            const proxyUrl = `/user/proxy-pdf?url=${encodeURIComponent(safeUrl)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error('Failed to load PDF');
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } else {
            window.open(safeUrl, '_blank');
        }
    } catch (err) {
        console.warn("Document preview failed, falling back to direct link", err);
        window.open(sanitizeUrl(rawUrl), '_blank');
    }
}

async function downloadDocument(rawUrl, fileName) {
    try {
        const safeUrl = sanitizeUrl(rawUrl);
        const isExplicitPdf = (fileName && fileName.toLowerCase().endsWith('.pdf')) || safeUrl.toLowerCase().includes('.pdf');
        const fetchUrl = isExplicitPdf ? `/user/proxy-pdf?url=${encodeURIComponent(safeUrl)}` : safeUrl;

        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error('Failed to fetch file stream');

        const blob = await response.blob();
        let finalFileName = fileName || 'download';

        if (!/\.[a-z0-9]+$/i.test(finalFileName)) {
            const mime = blob.type.toLowerCase();
            let ext = '';

            if (mime.includes('pdf')) ext = '.pdf';
            else if (mime.includes('spreadsheetml') || mime.includes('excel') || mime.includes('xls')) ext = '.xlsx';
            else if (mime.includes('wordprocessingml') || mime.includes('msword')) ext = '.docx';
            else if (mime.includes('csv')) ext = '.csv';
            else if (mime.includes('png')) ext = '.png';
            else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
            else if (mime.includes('text/plain')) ext = '.txt';
            else if (mime.includes('zip')) ext = '.zip';

            if (ext) finalFileName += ext;
        }

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = finalFileName;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
        console.error("Document download failed:", err);
        window.open(sanitizeUrl(rawUrl), '_blank');
    }
}

function appendBubble(msg, direction) {
    const stream = document.getElementById('messageStream');
    if (!stream) return;

    const isSelf = direction === 'sent';
    const msgDate = msg.timestamp ? new Date(msg.timestamp) : new Date();
    const timeStr = isNaN(msgDate.getTime()) 
        ? '' 
        : msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isWithinTimeWindow = !isNaN(msgDate.getTime()) && (Date.now() - msgDate.getTime()) <= EDIT_TIME_LIMIT_MS;

    const div = document.createElement('div');
    div.className = `msg-bubble ${direction}`;
    div.setAttribute('data-message-id', msg._id);

    if (msg.isDeleted) {
        div.innerHTML = `<div style="font-style: italic; opacity: 0.6; font-size: 13px;">This message was deleted</div>`;
        stream.appendChild(div);
        return;
    }

    let mediaHtml = '';
    if (msg.isViewOnce) {
        if (msg.isViewed) {
            mediaHtml = `<div style="opacity: 0.6; font-style: italic; font-size: 13px; margin-bottom: 4px;">📷 Opened Photo</div>`;
        } else if (isSelf) {
            mediaHtml = `<div style="font-style: italic; font-size: 13px; margin-bottom: 4px;">📷 View Once Photo Sent</div>`;
        } else {
            const safeMediaUrl = sanitizeUrl(msg.mediaUrl);
            mediaHtml = `
                <button class="btn-send" data-action="view-once" data-url="${escapeHtml(safeMediaUrl)}" style="padding: 6px 12px; font-size: 12px; margin-bottom: 4px; background: var(--accent);">
                    📷 Photo (Click to View)
                </button>`;
        }
    } else if (msg.mediaUrl) {
        const safeMediaUrl = sanitizeUrl(msg.mediaUrl);
        if (msg.mediaType === 'image') {
            mediaHtml = `<img src="${escapeHtml(safeMediaUrl)}" 
                             data-action="open-url" data-url="${escapeHtml(safeMediaUrl)}"
                             style="max-width:240px; width:100%; border-radius:8px; display:block; margin-bottom:6px; cursor:pointer;" 
                             alt="Uploaded Media">`;
        } else if (msg.mediaType === 'video') {
            mediaHtml = `
                <video controls playsinline 
                       style="max-width:260px; width:100%; border-radius:8px; display:block; margin-bottom:6px;">
                    <source src="${escapeHtml(safeMediaUrl)}">
                    Your browser does not support video playback.
                </video>`;
        } else if (msg.mediaType === 'document' || msg.mediaType === 'raw' || (msg.mediaUrl && msg.mediaUrl.match(/\.(pdf|docx?|txt|xlsx?)$/i))) {
            let rawFileName = msg.fileName;
            if (!rawFileName && msg.mediaUrl) {
                try {
                    const urlPath = new URL(msg.mediaUrl, window.location.origin).pathname;
                    rawFileName = decodeURIComponent(urlPath.split('/').pop());
                } catch (e) {
                    rawFileName = 'Attachment Document';
                }
            }
            const fileName = rawFileName || 'Attachment Document';
            const extMatch = fileName.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
            const fileExt = extMatch ? extMatch[1].toUpperCase() : 'FILE';

            mediaHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; background:rgba(255,255,255,0.1); border-radius:6px; margin-bottom:6px; max-width:280px;">
                    <div data-action="preview-doc" data-url="${escapeHtml(safeMediaUrl)}" data-filename="${escapeHtml(fileName)}" style="display:flex; align-items:center; gap:8px; overflow:hidden; text-decoration:none; color:inherit; flex:1; cursor:pointer;" title="Preview ${escapeHtml(fileName)}">
                        <span style="font-size:20px;">📄</span>
                        <div style="overflow:hidden; display:flex; flex-direction:column;">
                            <span style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; text-decoration:underline;">${escapeHtml(fileName)}</span>
                            <span style="font-size:9px; opacity:0.7; font-weight:600; text-transform:uppercase;">${fileExt}</span>
                        </div>
                    </div>
                    <button type="button" data-action="download-doc" data-url="${escapeHtml(safeMediaUrl)}" data-filename="${escapeHtml(fileName)}" title="Download file" style="background:none; border:none; color:inherit; font-size:14px; opacity:0.8; padding:4px; cursor:pointer;">
                        📥
                    </button>
                </div>`;
        }
    }

    const textHtml = msg.text ? `<div class="msg-text" style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(msg.text)}</div>` : '';
    const editedTag = msg.isEdited ? `<span class="edited-tag" style="font-size: 10px; opacity: 0.6; margin-left: 6px;">(edited)</span>` : '';

    let buttonsList = [];
    if (isSelf && isWithinTimeWindow) {
        const canEdit = msg.text && !msg.isViewOnce;
        if (canEdit) {
            buttonsList.push(`<span style="cursor:pointer; text-decoration:underline;" data-action="edit">Edit</span>`);
        }
        buttonsList.push(`<span style="cursor:pointer; text-decoration:underline;" data-action="delete">Delete for everyone</span>`);
    }

    if ((msg.text || msg.mediaUrl) && !msg.isViewOnce) {
        buttonsList.push(`<span style="cursor:pointer; text-decoration:underline;" data-action="forward" data-text="${escapeHtml(msg.text || '')}" data-media-url="${escapeHtml(msg.mediaUrl || '')}" data-media-type="${escapeHtml(msg.mediaType || '')}">Forward</span>`);
    }

    buttonsList.push(`<span style="cursor:pointer; text-decoration:underline; opacity:0.7;" data-action="delete-for-me">Delete for me</span>`);

    const actionButtons = `
        <div class="msg-actions" style="font-size:11px; margin-top:4px; display:flex; gap:8px; opacity:0.8;">
            ${buttonsList.join('')}
        </div>
    `;

    div.innerHTML = `
        ${mediaHtml}
        ${textHtml}
        <div class="msg-meta" style="font-size: 10px; opacity: 0.7; margin-top: 2px;">
            ${timeStr}${editedTag}
        </div>
        ${actionButtons}
    `;

    stream.appendChild(div);
}

function dispatchOutgoingMessage() {
    // Ensure active target is selected if clicking from DOM state
    if (!activeFriendId) {
        const activeCard = document.querySelector('.friend-card.active, [data-friend-id].active');
        if (activeCard) activeFriendId = activeCard.dataset.friendId;
    }

    if (!activeFriendId) {
        alert("No active conversation selected. Please click on a friend in the left sidebar.");
        return;
    }

    const input = document.getElementById('messagePayloadInput');
    const textPayload = input ? input.value.trim() : '';

    if (!textPayload && !selectedMediaData) return;

    const packet = {
        senderId: currentUserId,
        receiverId: activeFriendId,
        text: textPayload,
        mediaUrl: selectedMediaData ? selectedMediaData.mediaUrl : null,
        mediaType: selectedMediaData ? selectedMediaData.mediaType : null,
        fileName: selectedMediaData ? selectedMediaData.fileName : null,
        isViewOnce: isViewOnceMode
    };

    socket.emit('send_message', packet, (res) => {
        if (res && res.error) {
            alert(res.error);
        }
    });

    if (input) {
        input.value = '';
    }
    clearMediaSelection();

    if (isViewOnceMode) {
        toggleViewOnceMode();
    }
}

function triggerEdit(messageId, oldText) {
    const newText = prompt("Edit your message:", oldText);
    if (newText !== null && newText.trim() !== "" && newText.trim() !== oldText) {
        socket.emit('edit_message', {
            messageId,
            senderId: currentUserId, 
            receiverId: activeFriendId,
            newText: newText.trim()
        });
    }
}

function triggerDelete(messageId) {
    if (confirm("Are you sure you want to delete this message for everyone?")) {
        socket.emit('delete_message', {
            messageId,
            senderId: currentUserId, 
            receiverId: activeFriendId
        });
    }
}

// Fixed Forwarding Feature with Target Selection
// AFTER (Fixed):
function triggerForward(text, mediaUrl, mediaType) {
    // Legacy fallback redirect
    const activeMsg = document.querySelector('[data-message-id]');
    if (activeMsg) {
        openForwardModal(activeMsg.dataset.messageId);
    }
}

async function clearCurrentChat() {
    const headerEl = document.getElementById('activeChatHeader');
    const friendId = activeFriendId || headerEl?.dataset?.activeFriendId;

    if (!friendId) {
        alert("No active chat to clear.");
        return;
    }

    if (!confirm("Are you sure you want to clear this conversation history?")) {
        return;
    }

    try {
        const response = await fetch(`/user/chat/clear/${friendId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            const streamEl = document.getElementById('messageStream');
            if (streamEl) {
                streamEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-mute); font-size:13px;">No prior messages. Say hello!</div>';
            }
        } else {
            alert("Could not clear chat: " + (result.error || result.message || "Server error"));
        }
    } catch (err) {
        console.error("Error clearing chat:", err);
        alert("Something went wrong while clearing the chat.");
    }
}

async function deleteMessageForMe(messageId) {
    // 1. Prompt user for confirmation
    const isConfirmed = confirm("Are you sure you want to delete this message for yourself?");
    if (!isConfirmed) return; // User clicked Cancel

    try {
        const response = await fetch('/user/messages/delete-for-me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId })
        });

        const data = await response.json();
        if (data.success) {
            const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (msgEl) {
                msgEl.remove();
            }
        } else {
            alert("Failed to delete message. Please try again.");
        }
    } catch (err) {
        console.error("Failed to delete message locally:", err);
    }
}

socket.on('receive_message', (data) => {
    if (activeFriendId && (String(data.senderId) === String(activeFriendId) || String(data.senderId) === String(currentUserId))) {
        const direction = String(data.senderId) === String(currentUserId) ? 'sent' : 'received';
        appendBubble(data, direction);
        scrollStreamToBottom();
    }
});

socket.on('message_edited', ({ messageId, newText }) => {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        const textNode = msgEl.querySelector('.msg-text');
        if (textNode) textNode.innerText = newText;

        let metaBox = msgEl.querySelector('.msg-meta');
        if (metaBox && !metaBox.querySelector('.edited-tag')) {
            const tag = document.createElement('span');
            tag.className = 'edited-tag';
            tag.style.cssText = 'font-size: 10px; opacity: 0.6; margin-left: 6px;';
            tag.textContent = '(edited)';
            metaBox.appendChild(tag);
        }
    }
});

socket.on('message_deleted', ({ messageId }) => {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        msgEl.innerHTML = `<div style="font-style: italic; opacity: 0.6; font-size: 13px;">This message was deleted</div>`;
    }
});

socket.on('message_view_once_opened', ({ messageId }) => {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        msgEl.innerHTML = `<div style="opacity: 0.6; font-style: italic; font-size: 13px;">📷 Opened Photo</div>`;
    }
});

socket.on('action_error', (data) => {
    alert(data.message || "Action failed.");
});

async function manageUserAction(endpoint, targetId, extraData = {}) {
    if (!confirm("Are you sure you want to perform this action?")) return;
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId, ...extraData })
        });
        const data = await res.json();
        if (data.success) {
            window.location.reload();
        } else {
            alert(data.error || "Action failed");
        }
    } catch (err) {
        console.error("Action error:", err);
    }
}

async function sendFriendRequest(targetId) {
    const res = await fetch('/user/friend-request/send', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId })
    });
    const data = await res.json();
    if (data.success) { 
        alert("Friend request dispatched successfully!"); 
        const searchBox = document.getElementById('searchResults');
        if (searchBox) searchBox.style.display = 'none'; 
    } else {
        alert(data.error || "Failed to send request.");
    }
}

async function removeFriend(targetUserId) {
    if (!confirm("Are you sure you want to remove this friend? Chat history will be preserved.")) return;
    try {
        const res = await fetch('/user/remove-friend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId })
        });
        const data = await res.json();
        if (data.success) {
            window.location.reload();
        } else {
            alert(data.error || "Failed to remove friend.");
        }
    } catch (err) {
        console.error("Remove friend error:", err);
    }
}

function toggleModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
}

function closeModalOnOutsideClick(e, id) {
    if (e.target.id === id) toggleModal(id);
}

function scrollStreamToBottom() {
    const stream = document.getElementById('messageStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeUrl(url) {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (
        trimmed.startsWith('/') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('blob:')
    ) {
        return trimmed;
    }
    return '#';
}

document.addEventListener('DOMContentLoaded', () => {
    initializeChatEngine();

    document.addEventListener('click', (e) => {
        const friendCard = e.target.closest('.friend-card, [data-friend-id]');
        if (friendCard && !e.target.closest('.msg-actions')) {
            openConversationFromElement(friendCard);
        }
    });
    const clearChatBtn = document.querySelector('#activeChatHeader .fa-trash, #activeChatHeader [data-action="clear-chat"], .chat-header-actions .fa-trash, .chat-header-actions svg');
    if (clearChatBtn) {
        clearChatBtn.style.cursor = 'pointer';
        clearChatBtn.addEventListener('click', clearCurrentChat);
    }

    const sendBtn = document.getElementById('messageDispatchBtn');
    const inputField = document.getElementById('messagePayloadInput');
    const searchInput = document.getElementById('directorySearch');
    const mediaInput = document.getElementById('mediaFileInput');
    const messageStream = document.getElementById('messageStream');
    const searchResultsBox = document.getElementById('searchResults');

    if (messageStream) {
        messageStream.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const msgEl = target.closest('[data-message-id]');
            const messageId = msgEl ? msgEl.dataset.messageId : null;

            if (action === 'edit' && messageId) {
                const textNode = msgEl.querySelector('.msg-text');
                const oldText = textNode ? textNode.textContent : '';
                triggerEdit(messageId, oldText);
            } else if (action === 'delete' && messageId) {
                triggerDelete(messageId);
            } else if (action === 'forward') {
             openForwardModal(messageId);
            } else if (action === 'delete-for-me' && messageId) {
                deleteMessageForMe(messageId, msgEl);
            } else if (action === 'view-once' && messageId) {
                openViewOnceMedia(messageId, target.dataset.url);
            } else if (action === 'open-url') {
                window.open(sanitizeUrl(target.dataset.url), '_blank');
            } else if (action === 'preview-doc') {
                openDocumentPreview(target.dataset.url, target.dataset.filename);
            } else if (action === 'download-doc') {
                downloadDocument(target.dataset.url, target.dataset.filename);
            }
        });
    }

    if (searchResultsBox) {
        searchResultsBox.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const uid = button.dataset.uid;
            if (!uid) return;

            if (action === 'unblock') {
                manageUserAction('/user/unblock', uid);
            } else if (action === 'remove-friend') {
                removeFriend(uid);
            } else if (action === 'add-friend') {
                sendFriendRequest(uid);
            }
        });
    }

    if (mediaInput) {
        mediaInput.addEventListener('change', handleFileSelected);
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            dispatchOutgoingMessage();
        });
    }

    if (inputField) {
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                dispatchOutgoingMessage();
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const rawQuery = e.target.value.trim();
            const query = rawQuery.startsWith('@') ? rawQuery.substring(1).trim() : rawQuery;
            
            if (!searchResultsBox) return;

            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            if (searchAbortController) searchAbortController.abort();

            if (!query || query.length < 2) { 
                searchResultsBox.style.display = 'none'; 
                return; 
            }

            searchDebounceTimer = setTimeout(async () => {
                searchAbortController = new AbortController();
                try {
                    const res = await fetch(`/user/search?username=${encodeURIComponent(query)}`, {
                        signal: searchAbortController.signal
                    });
                    const users = await res.json();
                    const blockedList = window.CURRENT_USER_BLOCKED_ARRAY || [];
                    const friendsList = (window.CURRENT_USER_FRIENDS_ARRAY || []).map(f => String(f._id || f));

                    searchResultsBox.innerHTML = "";
                    if (!Array.isArray(users) || users.length === 0) {
                        searchResultsBox.innerHTML = '<div style="padding:12px; color:var(--text-mute); font-size:13px; text-align:center;">No users found</div>';
                    } else {
                        const fragment = document.createDocumentFragment();
                        users.forEach(u => {
                            const uid = String(u._id);
                            const isBlocked = blockedList.includes(uid);
                            const isFriend = friendsList.includes(uid);

                            let buttonHtml = '';
                            if (isBlocked) {
                                buttonHtml = `<button class="btn-send" style="padding:4px 10px; font-size:11px; background:var(--warning);" data-action="unblock" data-uid="${escapeHtml(uid)}">Unblock</button>`;
                            } else if (isFriend) {
                                buttonHtml = `<button class="btn-send" style="padding:4px 10px; font-size:11px; background:#ef4444;" data-action="remove-friend" data-uid="${escapeHtml(uid)}">Remove</button>`;
                            } else {
                                buttonHtml = `<button class="btn-send" style="padding:4px 10px; font-size:11px;" data-action="add-friend" data-uid="${escapeHtml(uid)}">Add</button>`;
                            }

                            const itemDiv = document.createElement('div');
                            itemDiv.className = 'search-item';
                            itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #eee);';
                            
                            const avatarSrc = sanitizeUrl(u.profileImage) || '/images/default-avatar.png';
                            
                            itemDiv.innerHTML = `
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <img src="${escapeHtml(avatarSrc)}" class="avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" alt="Avatar">
                                    <div style="display: flex; flex-direction: column;">
                                        <span style="font-weight: 600; font-size: 13px;">${escapeHtml(u.fullName || u.username)}</span>
                                        <span style="font-size: 11px; opacity: 0.7;">@${escapeHtml(u.username)}</span>
                                    </div>
                                </div>
                                ${buttonHtml}
                            `;
                            
                            fragment.appendChild(itemDiv);
                        });

                        searchResultsBox.appendChild(fragment);
                    }
                    searchResultsBox.style.display = 'block';
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error("Search error:", err);
                }
            }, 300);
        });
    }
});
window.SELECTED_MESSAGE_TO_FORWARD = null;

function openForwardModal(messageId) {
    if (!messageId) return;
    window.SELECTED_MESSAGE_TO_FORWARD = messageId;
    
    const container = document.getElementById('forwardFriendsList');
    const selectAllCheck = document.getElementById('selectAllForwardCheck');
    
    if (selectAllCheck) selectAllCheck.checked = false;

    // Retrieve friends list stored in appContainer data attribute
    const friends = window.CURRENT_USER_FRIENDS_ARRAY || [];
    
    if (friends.length === 0) {
        container.innerHTML = `
            <div style="color: var(--text-mute); font-size: 13px; text-align: center; padding: 12px;">
                No friends available to forward to.
            </div>`;
    } else {
        container.innerHTML = friends.map(friend => {
            const friendId = friend._id || friend;
            const name = friend.fullName || 'User';
            const username = friend.username || 'user';
            const avatar = friend.profileImage || '/images/default-avatar.png';

            return `
                <label style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                        <div>
                            <div style="font-size: 13px; font-weight: 500;">${name}</div>
                            <div style="font-size: 11px; color: var(--text-mute);">@${username}</div>
                        </div>
                    </div>
                    <input type="checkbox" class="forward-friend-checkbox" value="${friendId}" style="accent-color: var(--accent); width: 16px; height: 16px;">
                </label>
            `;
        }).join('');
    }

    toggleModal('forwardModal');
}

function toggleSelectAllForward(masterCheckbox) {
    const checkboxes = document.querySelectorAll('.forward-friend-checkbox');
    checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}

async function submitForwardMessage() {
    const messageId = window.SELECTED_MESSAGE_TO_FORWARD;
    if (!messageId) return alert("No message selected.");

    const checkedBoxes = document.querySelectorAll('.forward-friend-checkbox:checked');
    const recipientIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (recipientIds.length === 0) {
        return alert('Please select at least one friend to forward this message to.');
    }

    try {
        const response = await fetch('/user/messages/forward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, recipientIds })
        });

        const result = await response.json();

        if (result.success) {
            toggleModal('forwardModal');
            window.SELECTED_MESSAGE_TO_FORWARD = null;

            const headerEl = document.getElementById('activeChatHeader');
            const activeId = activeFriendId || headerEl?.dataset?.activeFriendId;
            if (activeId && recipientIds.includes(activeId)) {
                openConversationFromElement(document.querySelector(`[data-friend-id="${activeId}"]`));
            }
        } else {
            alert("Forwarding failed: " + (result.error || result.message || "Server error"));
        }
    } catch (err) {
        console.error("Error forwarding message:", err);
    }
}
/* Keep chat stream visible above mobile keyboard */
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
      // Set container height directly to the visual viewport height
      appContainer.style.height = `${window.visualViewport.height}px`;
    }

    // Scroll chat stream to bottom
    const messageStream = document.querySelector('.chat-messages');
    if (messageStream) {
      messageStream.scrollTop = messageStream.scrollHeight;
    }
  });
}