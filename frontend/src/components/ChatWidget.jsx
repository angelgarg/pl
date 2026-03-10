/**
 * BhoomiIQ — Floating AI Chat Widget
 * "Ask BhoomiIQ" button → opens a chat window powered by Azure GPT-4o.
 * Supports Hindi and English based on the current app language.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useLang } from '../LangContext';
import { LANG_OPTIONS } from '../i18n';
import { sendChatMessage } from '../api';

// Suggested quick questions shown on first open — all 10 Indian languages
const QUICK_QUESTIONS = {
  en: [
    '💧 When should I water my tomatoes?',
    '🌡️ My soil temp is 38°C — is that bad?',
    '🌿 Yellow leaves on my plant — why?',
    '🐛 How do I treat pest infestation?',
    '💡 Best crops for summer in India?',
  ],
  hi: [
    '💧 मेरे टमाटर को कब पानी दें?',
    '🌡️ मिट्टी का तापमान 38°C — क्या यह ठीक है?',
    '🌿 पौधे की पत्तियां पीली क्यों हो रही हैं?',
    '🐛 कीट हमले से कैसे बचाएं?',
    '💡 भारत में गर्मियों की सबसे अच्छी फसल?',
  ],
  mr: [
    '💧 माझ्या टोमॅटोला कधी पाणी द्यावे?',
    '🌡️ मातीचे तापमान 38°C — हे ठीक आहे का?',
    '🌿 पानांचा रंग पिवळा का होतोय?',
    '🐛 कीटकांपासून बचाव कसा करावा?',
    '💡 उन्हाळ्यात महाराष्ट्रात सर्वोत्तम पीक कोणते?',
  ],
  pa: [
    '💧 ਮੇਰੇ ਟਮਾਟਰਾਂ ਨੂੰ ਕਦੋਂ ਪਾਣੀ ਦੇਣਾ ਚਾਹੀਦਾ ਹੈ?',
    '🌡️ ਮਿੱਟੀ ਦਾ ਤਾਪਮਾਨ 38°C — ਕੀ ਇਹ ਠੀਕ ਹੈ?',
    '🌿 ਪੱਤੇ ਪੀਲੇ ਕਿਉਂ ਹੋ ਰਹੇ ਹਨ?',
    '🐛 ਕੀੜਿਆਂ ਤੋਂ ਕਿਵੇਂ ਬਚਾਈਏ?',
    '💡 ਗਰਮੀਆਂ ਵਿੱਚ ਪੰਜਾਬ ਲਈ ਸਭ ਤੋਂ ਵਧੀਆ ਫ਼ਸਲ?',
  ],
  ta: [
    '💧 என் தக்காளிக்கு எப்போது தண்ணீர் பாய்ச்ச வேண்டும்?',
    '🌡️ மண் வெப்பம் 38°C — இது சரியா?',
    '🌿 இலைகள் மஞ்சளாவது ஏன்?',
    '🐛 பூச்சிகளிடமிருந்து எப்படி பாதுகாப்பது?',
    '💡 கோடையில் தமிழ்நாட்டில் சிறந்த பயிர் எது?',
  ],
  te: [
    '💧 నా టమాటాలకు ఎప్పుడు నీళ్ళు పోయాలి?',
    '🌡️ నేల ఉష్ణోగ్రత 38°C — ఇది సరైనదా?',
    '🌿 ఆకులు పసుపు రంగుకు మారడం ఎందుకు?',
    '🐛 పురుగుల బారి నుండి ఎలా రక్షించుకోవాలి?',
    '💡 వేసవిలో ఆంధ్రప్రదేశ్‌లో అత్యుత్తమ పంట ఏది?',
  ],
  kn: [
    '💧 ನನ್ನ ಟೊಮೇಟೊಗಳಿಗೆ ಯಾವಾಗ ನೀರು ಹಾಕಬೇಕು?',
    '🌡️ ಮಣ್ಣಿನ ತಾಪಮಾನ 38°C — ಇದು ಸರಿಯೇ?',
    '🌿 ಎಲೆಗಳು ಹಳದಿ ಬಣ್ಣಕ್ಕೆ ತಿರುಗುತ್ತಿರುವುದು ಏಕೆ?',
    '🐛 ಕೀಟಗಳಿಂದ ಹೇಗೆ ರಕ್ಷಿಸಿಕೊಳ್ಳುವುದು?',
    '💡 ಬೇಸಿಗೆಯಲ್ಲಿ ಕರ್ನಾಟಕದಲ್ಲಿ ಉತ್ತಮ ಬೆಳೆ ಯಾವುದು?',
  ],
  gu: [
    '💧 મારા ટામેટાંને ક્યારે પાણી આપવું?',
    '🌡️ માટીનું તાપમાન 38°C — શું આ ઠીક છે?',
    '🌿 પાંદડા પીળા કેમ પડી રહ્યા છે?',
    '🐛 જંતુઓથી કેવી રીતે બચાવ કરવો?',
    '💡 ઉનાળામાં ગુજરાત માટે શ્રેષ્ઠ પાક કયો છે?',
  ],
  bn: [
    '💧 আমার টমেটোতে কখন জল দেব?',
    '🌡️ মাটির তাপমাত্রা 38°C — এটা কি ঠিক আছে?',
    '🌿 পাতা হলুদ হয়ে যাচ্ছে কেন?',
    '🐛 পোকামাকড় থেকে কীভাবে রক্ষা করব?',
    '💡 গ্রীষ্মে পশ্চিমবঙ্গে সেরা ফসল কোনটি?',
  ],
  ml: [
    '💧 എന്റെ തക്കാളിക്ക് എപ്പോൾ വെള്ളം ഒഴിക്കണം?',
    '🌡️ മണ്ണിന്റെ താപനില 38°C — ഇത് ശരിയാണോ?',
    '🌿 ഇലകൾ മഞ്ഞ നിറമാകുന്നത് എന്തുകൊണ്ട്?',
    '🐛 കീടങ്ങളിൽ നിന്ന് എങ്ങനെ രക്ഷിക്കാം?',
    '💡 വേനലിൽ കേരളത്തിൽ ഏറ്റവും നല്ല വിള ഏതാണ്?',
  ],
};

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
      {!isUser && <span className="chat-bubble-avatar">🌿</span>}
      <div className="chat-bubble-text">{msg.content}</div>
    </div>
  );
}

export default function ChatWidget() {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Reset messages when language changes (to show welcome in new language)
  useEffect(() => {
    setMessages([{ role: 'ai', content: t('chatWelcome') }]);
  }, [lang]);

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setUnread(0);
    }
  }, [open]);

  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setLoading(true);

    try {
      const { reply } = await sendChatMessage(trimmed, lang);
      setMessages(prev => [...prev, { role: 'ai', content: reply }]);
      if (!open) setUnread(n => n + 1);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: t('chatError') }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Chat window */}
      {open && (
        <div className="chat-window">
          <div className="chat-header">
            <span className="chat-header-icon">🌿</span>
            <span className="chat-header-title">{t('chatTitle')}</span>
            <span className="chat-header-lang">
              {LANG_OPTIONS.find(o => o.value === lang)?.native || 'English'}
            </span>
            <button className="chat-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-messages">
            {messages.map((msg, i) => (
              <Bubble key={i} msg={msg} />
            ))}
            {loading && (
              <div className="chat-bubble chat-bubble-ai">
                <span className="chat-bubble-avatar">🌿</span>
                <div className="chat-bubble-text chat-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick question chips — only when no conversation yet */}
          {messages.length <= 1 && !loading && (
            <div className="chat-quick-questions">
              {(QUICK_QUESTIONS[lang] || QUICK_QUESTIONS.en).map((q, i) => (
                <button
                  key={i}
                  className="chat-quick-btn"
                  onClick={() => sendMessage(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chatPlaceholder')}
              rows={1}
              disabled={loading}
            />
            <button
              className="chat-send-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              title={t('chatSend')}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        className={`chat-fab ${open ? 'chat-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={t('chatTitle')}
      >
        {open ? '✕' : '🤖'}
        {!open && unread > 0 && (
          <span className="chat-fab-badge">{unread}</span>
        )}
      </button>
    </>
  );
}
