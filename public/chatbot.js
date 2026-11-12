/**
 * ==========================================================================
 * المساعد البيئي الذكي - حملة بيئتنا لوحتنا | جامعة إربد الأهلية
 * السكربت التفاعلي للعميل (chatbot.js)
 * متصل مباشرة بالخادم الآمن مع إدارة كاملة لحالة الجلسة وسياق المحادثة
 * ==========================================================================
 */

(function () {
  'use strict';

  // الإعدادات العامة للمساعد
  const CONFIG = {
    apiEndpoint: '/api/chat',
    welcomeMessage: 'مرحبًا! 🌱 أنا مساعدك البيئي في حملة بيئتنا لوحتنا بجامعة إربد الأهلية. اسألني عن الحملة أو النظافة أو المحافظة على البيئة.',
    suggestions: [
      { emoji: '🌱', text: 'ما أهداف الحملة؟' },
      { emoji: '♻️', text: 'كيف أساهم في حماية البيئة؟' },
      { emoji: '📍', text: 'كيف أبلغ عن مكان يحتاج تنظيف؟' },
      { emoji: '💡', text: 'أعطني فكرة لمبادرة بيئية.' },
      { emoji: '🤝', text: 'كيف أشارك في الحملة؟' }
    ],
    maxRetries: 2,
    retryDelay: 1200
  };

  // حالة المحادثة وسجل الجلسة
  let conversationHistory = []; // مصفوفة { role: 'user' | 'assistant', content: string }
  let isLoading = false;
  let isOpen = false;

  // عناصر واجهة المستخدم
  let widgetRoot = null;
  let chatToggle = null;
  let chatWindow = null;
  let messagesContainer = null;
  let suggestionsContainer = null;
  let chatInput = null;
  let sendButton = null;
  let typingIndicator = null;

  /**
   * تنسيق الوقت الحالي بتوقيت محلي أنيق (مثال: 10:45 ص)
   */
  function formatCurrentTime() {
    try {
      return new Intl.DateTimeFormat('ar-JO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(new Date());
    } catch (e) {
      const d = new Date();
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }

  /**
   * تحويل التنسيقات البسيطة (Markdown مثل الروابط والخط العريض) إلى HTML آمن
   */
  function formatMarkdown(text) {
    if (!text) return '';
    
    // حماية ضد حقن الأكواد
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // تحويل **النص العريض**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // تحويل *المائل*
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // تحويل الروابط [نص](رابط)
    escaped = escaped.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // ربط كلمة "نموذج الإبلاغ" بالتمرير التلقائي لقسم الإبلاغ في الصفحة
    escaped = escaped.replace(/نموذج الإبلاغ/g, '<a href="#report-section" class="eco-inline-report-link" title="انقر للانتقال مباشرة لنموذج الإبلاغ">نموذج الإبلاغ 📍</a>');

    // تحويل القوائم النقطية
    const lines = escaped.split('\n');
    let inList = false;
    let result = '';

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (/^(\s*)[-*•]\s+(.*)/.test(line)) {
        if (!inList) {
          result += '<ul>';
          inList = true;
        }
        result += '<li>' + line.replace(/^(\s*)[-*•]\s+/, '') + '</li>';
      } else {
        if (inList) {
          result += '</ul>';
          inList = false;
        }
        result += (i > 0 && lines[i-1].trim() !== '' ? '<br>' : '') + line;
      }
    }
    if (inList) result += '</ul>';

    return result;
  }

  /**
   * إنشاء شجرة عناصر الودجت بالكامل وحقنها في الـ DOM
   */
  function buildWidgetDOM() {
    widgetRoot = document.createElement('div');
    widgetRoot.className = 'eco-widget-root';

    // 1. زر الفتح العائم
    chatToggle = document.createElement('button');
    chatToggle.className = 'eco-chat-toggle';
    chatToggle.setAttribute('aria-label', 'فتح المساعد البيئي');
    chatToggle.setAttribute('title', 'المساعد البيئي - جامعة إربد الأهلية');
    chatToggle.innerHTML = `
      <div class="eco-toggle-pulse"></div>
      <span class="eco-toggle-badge" aria-hidden="true"></span>
      <span class="eco-toggle-icon">🌱</span>
    `;

    // 2. نافذة المحادثة
    chatWindow = document.createElement('div');
    chatWindow.className = 'eco-chat-window';
    chatWindow.setAttribute('role', 'dialog');
    chatWindow.setAttribute('aria-label', 'نافذة المساعد البيئي');

    // ترويسة النافذة
    const header = document.createElement('header');
    header.className = 'eco-chat-header';
    header.innerHTML = `
      <div class="eco-header-brand">
        <div class="eco-header-avatar">
          🌱
          <span class="eco-avatar-dot" title="متصل وجاهز للإجابة"></span>
        </div>
        <div class="eco-header-titles">
          <h3 class="eco-header-title">المساعد البيئي 🌱</h3>
          <span class="eco-header-sub">بيئتنا لوحتنا | جامعة إربد الأهلية</span>
        </div>
      </div>
      <div class="eco-header-actions">
        <button class="eco-header-btn eco-btn-clear" title="مسح المحادثة وبدء محادثة جديدة" aria-label="مسح المحادثة">
          🗑️
        </button>
        <button class="eco-header-btn eco-btn-close" title="إغلاق المحادثة" aria-label="إغلاق المحادثة">
          ✕
        </button>
      </div>
    `;

    // منطقة الرسائل
    messagesContainer = document.createElement('div');
    messagesContainer.className = 'eco-chat-messages';
    messagesContainer.setAttribute('aria-live', 'polite');

    // منطقة مؤشر الكتابة
    typingIndicator = document.createElement('div');
    typingIndicator.className = 'eco-typing-indicator';
    typingIndicator.style.display = 'none';
    typingIndicator.innerHTML = `
      <div class="eco-typing-dot"></div>
      <div class="eco-typing-dot"></div>
      <div class="eco-typing-dot"></div>
    `;

    // منطقة إدخال الرسائل
    const inputArea = document.createElement('div');
    inputArea.className = 'eco-chat-input-area';
    inputArea.innerHTML = `
      <div class="eco-input-wrapper">
        <input 
          type="text" 
          class="eco-chat-input" 
          placeholder="اكتب استفسارك للمساعد البيئي هنا..." 
          aria-label="رسالتك للمساعد البيئي"
          autocomplete="off"
        />
      </div>
      <button class="eco-chat-send" title="إرسال الرسالة" aria-label="إرسال">
        <svg class="eco-send-svg" viewBox="0 0 24 24">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    `;

    const footerNote = document.createElement('div');
    footerNote.className = 'eco-chat-footer-note';
    footerNote.textContent = 'مساعد ذكي مدعوم بالذكاء الاصطناعي لحملة بيئتنا لوحتنا';

    // التجميع
    chatWindow.appendChild(header);
    chatWindow.appendChild(messagesContainer);
    chatWindow.appendChild(inputArea);
    chatWindow.appendChild(footerNote);

    widgetRoot.appendChild(chatToggle);
    widgetRoot.appendChild(chatWindow);
    document.body.appendChild(widgetRoot);

    // ربط المتغيرات بالعناصر المنشأة
    chatInput = inputArea.querySelector('.eco-chat-input');
    sendButton = inputArea.querySelector('.eco-chat-send');

    // إرفاق مستمعي الأحداث
    attachEventListeners(header);
  }

  /**
   * ربط الأحداث التفاعلية
   */
  function attachEventListeners(header) {
    // فتح / إغلاق المحادثة
    chatToggle.addEventListener('click', toggleChat);
    header.querySelector('.eco-btn-close').addEventListener('click', toggleChat);

    // زر مسح المحادثة
    header.querySelector('.eco-btn-clear').addEventListener('click', () => {
      if (confirm('هل ترغب في مسح سجل المحادثة والبدء من جديد؟')) {
        clearChat();
      }
    });

    // إرسال الرسالة عند النقر
    sendButton.addEventListener('click', handleUserSend);

    // إرسال الرسالة عند ضغط زر Enter
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserSend();
      }
    });

    // التمرير السلس عند النقر على روابط نموذج الإبلاغ
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.eco-inline-report-link');
      if (link) {
        e.preventDefault();
        const target = document.getElementById('report-section');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
          target.classList.add('highlight-pulse');
          setTimeout(() => target.classList.remove('highlight-pulse'), 2000);
          // تصغير النافذة في شاشات الموبايل حتى يرى المستخدم النموذج
          if (window.innerWidth <= 768 && isOpen) toggleChat();
        }
      }
    });

    // ضبط التمرير عند ظهور لوحة المفاتيح في الهواتف
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (isOpen) scrollToBottom();
      });
    }
  }

  /**
   * فتح أو إغلاق نافذة المحادثة
   */
  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.add('active');
      chatToggle.classList.add('active');
      setTimeout(() => chatInput.focus(), 300);
      scrollToBottom();
    } else {
      chatWindow.classList.remove('active');
      chatToggle.classList.remove('active');
    }
  }

  /**
   * التمرير التلقائي لأسفل صندوق المحادثة
   */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  /**
   * إضافة رسالة إلى واجهة المحادثة
   * @param {string} content نص الرسالة
   * @param {'user'|'bot'} sender هوية المرسل
   * @param {boolean} isError هل الرسالة إشعار خطأ
   */
  function addMessage(content, sender, isError = false) {
    const row = document.createElement('div');
    row.className = `eco-message-row ${sender}`;

    if (sender === 'bot') {
      const avatar = document.createElement('div');
      avatar.className = 'eco-message-avatar';
      avatar.textContent = '🌱';
      avatar.setAttribute('aria-hidden', 'true');
      row.appendChild(avatar);
    }

    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.style.maxWidth = '85%';

    const bubble = document.createElement('div');
    bubble.className = `eco-bubble ${isError ? 'eco-error-bubble' : ''}`;
    bubble.innerHTML = formatMarkdown(content);

    const time = document.createElement('div');
    time.className = 'eco-message-time';
    time.textContent = formatCurrentTime();

    bubbleWrapper.appendChild(bubble);
    bubbleWrapper.appendChild(time);
    row.appendChild(bubbleWrapper);

    messagesContainer.appendChild(row);
    scrollToBottom();

    return row;
  }

  /**
   * عرض أزرار الأسئلة السريعة المقترحة
   */
  function renderSuggestions() {
    // إزالة أي اقتراحات سابقة إن وجدت
    const existing = messagesContainer.querySelector('.eco-suggestions-wrap');
    if (existing) existing.remove();

    suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'eco-suggestions-wrap';

    const title = document.createElement('div');
    title.className = 'eco-suggestions-title';
    title.innerHTML = '<span>💡</span> أسئلة مقترحة للبدء السريع:';

    const grid = document.createElement('div');
    grid.className = 'eco-suggestions-grid';

    CONFIG.suggestions.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'eco-suggestion-btn';
      btn.innerHTML = `<span>${item.emoji}</span> <span>${item.text}</span>`;
      btn.addEventListener('click', () => {
        if (!isLoading) {
          chatInput.value = item.text;
          handleUserSend();
        }
      });
      grid.appendChild(btn);
    });

    suggestionsContainer.appendChild(title);
    suggestionsContainer.appendChild(grid);
    messagesContainer.appendChild(suggestionsContainer);
    scrollToBottom();
  }

  /**
   * إظهار مؤشر الانتظار المتحرك
   */
  function showTypingIndicator() {
    if (!messagesContainer.contains(typingIndicator)) {
      messagesContainer.appendChild(typingIndicator);
    }
    typingIndicator.style.display = 'flex';
    scrollToBottom();
  }

  /**
   * إخفاء مؤشر الانتظار المتحرك
   */
  function hideTypingIndicator() {
    if (typingIndicator) {
      typingIndicator.style.display = 'none';
      if (messagesContainer.contains(typingIndicator)) {
        messagesContainer.removeChild(typingIndicator);
      }
    }
  }

  /**
   * معالجة إرسال المستخدم للرسالة
   */
  async function handleUserSend() {
    const text = (chatInput.value || '').trim();
    if (!text || isLoading) return;

    // مسح حقل الإدخال
    chatInput.value = '';

    // إخفاء حاوية الاقتراحات بعد أول رسالة
    const existingSuggestions = messagesContainer.querySelector('.eco-suggestions-wrap');
    if (existingSuggestions) {
      existingSuggestions.style.display = 'none';
    }

    // 1. إضافة رسالة المستخدم للواجهة
    addMessage(text, 'user');

    // 2. تحديث سجل المحادثة للاحتفاظ بالسياق
    conversationHistory.push({ role: 'user', content: text });

    // 3. تفعيل حالة التحميل
    setLoadingState(true);
    showTypingIndicator();

    try {
      // إرسال الطلب للخادم مع إعادة المحاولة التلقائية في حال انقطاع الشبكة
      const reply = await sendChatRequestWithRetry(conversationHistory);
      
      hideTypingIndicator();

      if (reply) {
        addMessage(reply, 'bot');
        conversationHistory.push({ role: 'assistant', content: reply });
      }
    } catch (err) {
      hideTypingIndicator();
      console.error('Chat error:', err);
      const errorMsg = err.message || 'عذرًا، تعذر الاتصال بالمساعد البيئي حاليًا. يرجى التأكد من اتصال الإنترنت والمحاولة مجددًا 🌱.';
      addMessage(errorMsg, 'bot', true);
    } finally {
      setLoadingState(false);
      chatInput.focus();
    }
  }

  /**
   * إرسال الطلب إلى نقطة النهاية /api/chat مع إعادة المحاولة
   */
  async function sendChatRequestWithRetry(messages, attempt = 1) {
    try {
      const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // إذا كان هناك خطأ محدد من الخادم
        throw new Error(data.error || `خطأ في الخادم (${response.status})`);
      }

      return data.reply;
    } catch (err) {
      if (attempt < CONFIG.maxRetries) {
        console.warn(`إعادة المحاولة (${attempt}/${CONFIG.maxRetries})...`);
        await new Promise(r => setTimeout(r, CONFIG.retryDelay));
        return sendChatRequestWithRetry(messages, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * تحديث واجهة المستخدم أثناء التحميل
   */
  function setLoadingState(loading) {
    isLoading = loading;
    sendButton.disabled = loading;
    chatInput.disabled = loading;
  }

  /**
   * مسح المحادثة بالكامل وإعادة ضبطها
   */
  function clearChat() {
    conversationHistory = [];
    messagesContainer.innerHTML = '';
    hideTypingIndicator();
    setLoadingState(false);

    // إضافة الرسالة الترحيبية
    addMessage(CONFIG.welcomeMessage, 'bot');

    // إعادة عرض الأسئلة المقترحة
    renderSuggestions();
  }

  /**
   * التهيئة الأولية للمساعد عند تحميل الصفحة
   */
  function init() {
    buildWidgetDOM();
    clearChat();
  }

  // تشغيل التهيئة عند جاهزية مستند الـ DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

