import { useState, useEffect, useRef } from 'react';
import { getSelectedSets, setSelectedSets, getSessionCards, updateCardStat } from './services/storage';
import './App.css';

const SCREENS = {
  USER_SELECTION: 'USER_SELECTION',
  SET_SELECTION: 'SET_SELECTION',
  SESSION: 'SESSION',
  SUMMARY: 'SUMMARY'
};

const NUMBER_MAP = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
  'eleven': '11', 'twelve': '12', 'thirteen': '13', 'fourteen': '14', 'fifteen': '15',
  'sixteen': '16', 'seventeen': '17', 'eighteen': '18', 'nineteen': '19', 'twenty': '20',
  'thirty': '30', 'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
  'eighty': '80', 'ninety': '90', 'hundred': '100'
};

function normalizeText(text) {
  return text.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
}

function matchAnswer(transcript, target) {
  const normT = normalizeText(transcript);
  const normTarget = normalizeText(target);
  if (normT === normTarget) return true;
  let mappedT = normT;
  Object.keys(NUMBER_MAP).forEach(word => {
    mappedT = mappedT.replace(new RegExp(`\\b${word}\\b`, 'g'), NUMBER_MAP[word]);
  });
  const mappedNoSpaces = mappedT.replace(/\s+/g, '');
  if (mappedNoSpaces === normTarget) return true;
  const parts = mappedT.split(/\s+/);
  if (parts.length > 1 && parts.every(p => p === normTarget)) return true;
  if (parts.includes(normTarget)) return true;
  return false;
}

const playSound = (type) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'correct') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } else if (type === 'wrong') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }
};

function getFontSize(text) {
  if (!text) return '3.5rem';
  const len = text.length;
  if (len <= 5) return '3.5rem';
  if (len <= 10) return '2.8rem';
  if (len <= 20) return '2rem';
  if (len <= 40) return '1.5rem';
  return '1.2rem';
}

function App() {
  const [screen, setScreen] = useState(SCREENS.USER_SELECTION);
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [serverUser, setServerUser] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [sessionsToday, setSessionsToday] = useState(0);
  const [sessionsYesterday, setSessionsYesterday] = useState(0);
  const [greeting, setGreeting] = useState("");
  const [availableSets, setAvailableSets] = useState([]);
  const [selectedSetIds, setSelectedSetIds] = useState(getSelectedSets());
  const [sessionCards, setSessionCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState({ correct: 0, total: 0 });
  const [isListening, setIsListening] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isAppSpeaking, setIsAppSpeaking] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [wrongCount, setWrongCount] = useState(0);
  const recognitionRef = useRef(null);
  const lastSpokenIndexRef = useRef(-1);
  const checkVoiceAnswerRef = useRef();

  useEffect(() => {
    checkVoiceAnswerRef.current = checkVoiceAnswer;
  });

  useEffect(() => {
    fetch('/data/index.json').then(res => res.json()).then(data => setAvailableSets(data));
    fetch('/data/users.json').then(res => res.json()).then(data => setUsers(data));

    // Fetch profile and history from backend
    fetch('/api/profile').then(res => res.json()).then(data => {
      if (data) {
        setServerUser(data);
        setCurrentUser({ id: data.email, name: data.firstName });
        setScreen(SCREENS.SET_SELECTION);
      }
    }).catch(() => {});

    fetch('/api/history').then(res => res.json()).then(data => setActivityLog(data || []));

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Switch to false for faster finalization
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        checkVoiceAnswerRef.current?.(transcript);
      };
      recognition.onend = () => {
        setIsListening(false);
        // Manual restart if we are still in the session and not speaking/flipped
        if (recognitionRef.current && !checkVoiceAnswerRef.current?.isPaused) {
           try { recognition.start(); setIsListening(true); } catch (e) {}
        }
      };
      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => {
    // Helper to check if recognition should be active
    const shouldListen = screen === SCREENS.SESSION && !isFlipped && !feedback && !isAppSpeaking;
    
    // Attach a flag to the ref so onend knows if it should restart
    if (checkVoiceAnswerRef.current) {
      checkVoiceAnswerRef.current.isPaused = !shouldListen;
    }

    if (shouldListen) {
      if (audioEnabled && lastSpokenIndexRef.current !== currentIndex) {
        speak(sessionCards[currentIndex].front.value);
        lastSpokenIndexRef.current = currentIndex;
      }
      try { recognitionRef.current?.start(); setIsListening(true); } catch (e) {}
    } else {
      try { recognitionRef.current?.stop(); } catch (e) {}
      setIsListening(false);
    }
  }, [screen, currentIndex, isFlipped, feedback, audioEnabled, isAppSpeaking]);

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    // Improve math pronunciation: replace 'x' with 'times' if it looks like an equation
    let spokenText = text;
    if (/\d+\s*x\s*\d+/.test(text)) {
      spokenText = text.replace(/x/g, 'times');
    }
    
    const utterance = new SpeechSynthesisUtterance(spokenText);
    
    // Determine language based on the current card or set
    const card = sessionCards[currentIndex];
    if (card && card.id && card.id.includes('indonesian')) {
      utterance.lang = 'id-ID';
    } else {
      utterance.lang = 'en-US';
    }

    utterance.onstart = () => setIsAppSpeaking(true);
    utterance.onend = () => setIsAppSpeaking(false);
    utterance.onerror = () => setIsAppSpeaking(false);
    
    // Add a tiny delay to ensure the card has visually flipped and state has settled
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  };

  const setLocalGreeting = (type, score = null, name = null, today = null, yesterday = null) => {
    const userName = name || currentUser.name;
    const sToday = today !== null ? today : sessionsToday;
    const sYesterday = yesterday !== null ? yesterday : sessionsYesterday;

    if (type === 'start') {
      if (sToday > 0) {
        setGreeting(`Welcome back, ${userName}! Ready for session number ${sToday + 1}?`);
      } else if (sYesterday > 0) {
        setGreeting(`Great to see you again, ${userName}! You did ${sYesterday} session${sYesterday > 1 ? 's' : ''} yesterday. Let's get cracking!`);
      } else {
        setGreeting(`Hi ${userName}! Let's start learning something new today!`);
      }
    } else {
      const accuracy = Math.round((score.correct / score.total) * 100);
      if (accuracy >= 90) {
        setGreeting(`Incredible work, ${userName}! ${accuracy}% accuracy is amazing!`);
      } else if (accuracy >= 70) {
        setGreeting(`Great job, ${userName}! You're getting really good at this.`);
      } else {
        setGreeting(`Well done on finishing the session, ${userName}. Keep practicing!`);
      }
    }
  };

  const selectUser = (user) => {
    setCurrentUser(user);
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const todayKey = `fc_sessions_${user.id}_${todayStr}`;
    const yesterdayKey = `fc_sessions_${user.id}_${yesterdayStr}`;
    const tCount = parseInt(localStorage.getItem(todayKey) || '0');
    const yCount = parseInt(localStorage.getItem(yesterdayKey) || '0');
    setSessionsToday(tCount);
    setSessionsYesterday(yCount);
    setLocalGreeting('start', null, user.name, tCount, yCount);
    setScreen(SCREENS.SET_SELECTION);
  };

  const trackSessionComplete = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const key = `fc_sessions_${currentUser.id}_${todayStr}`;
    const newCount = sessionsToday + 1;
    localStorage.setItem(key, newCount.toString());
    setSessionsToday(newCount);
    setLocalGreeting('end', sessionResults);

    // Log to backend
    fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({
        action: 'session_complete',
        details: {
          correct: sessionResults.correct,
          total: sessionResults.total,
          accuracy: Math.round((sessionResults.correct / sessionResults.total) * 100)
        }
      })
    }).then(() => {
      // Refresh history
      fetch('/api/history').then(res => res.json()).then(data => setActivityLog(data || []));
    });
  };

  const saveProfile = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const firstName = formData.get('firstName');
    const lastName = formData.get('lastName');
    
    fetch('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName })
    }).then(() => {
      setServerUser({ firstName, lastName });
      setCurrentUser({ id: 'me', name: firstName });
      setScreen(SCREENS.SET_SELECTION);
    });
  };

  const checkVoiceAnswer = (transcript) => {
    if (isFlipped || feedback || screen !== SCREENS.SESSION) return;
    const normT = normalizeText(transcript);
    if (normT === 'pass') { handlePass(); return; }
    const card = sessionCards[currentIndex];
    if (matchAnswer(transcript, card.back.value)) { handleCorrect(); } else { handleWrong(transcript); }
  };

  const handlePass = () => {
    playSound('wrong');
    setFeedback('wrong');
    setIsFlipped(true);
    const card = sessionCards[currentIndex];
    if (audioEnabled) {
      speak(`The answer is ${card.back.value}`);
    }
    setVoiceMsg("Let's look at the answer and try the next one.");
    setTimeout(() => nextCard(1), 3000);
  };

  const handleCorrect = () => {
    playSound('correct');
    setFeedback('correct');
    setIsFlipped(true);
    setSessionResults(prev => ({ ...prev, correct: prev.correct + 1 }));
    setVoiceMsg('Great job!');
    setWrongCount(0);
    setTimeout(() => nextCard(4), 1500);
  };

  const handleWrong = (transcript) => {
    if (!transcript.trim()) { setVoiceMsg("Sorry, I didn't catch that. Try again?"); return; }
    const newWrongCount = wrongCount + 1;
    setWrongCount(newWrongCount);
    playSound('wrong');
    setFeedback('wrong');
    
    if (newWrongCount >= 2) { // Reduced to 2 chances for faster feedback
      setIsFlipped(true);
      const card = sessionCards[currentIndex];
      if (audioEnabled) {
        speak(`The answer is ${card.back.value}`);
      }
      setVoiceMsg(`The answer is ${card.back.value}. Let's move on.`);
      setTimeout(() => nextCard(1), 5000);
    } else {
      setVoiceMsg(`I heard "${transcript.trim()}", but that's not it!`);
      setTimeout(() => setFeedback(null), 1200);
    }
  };

  const nextCard = (quality) => {
    const card = sessionCards[currentIndex];
    updateCardStat(card.id, quality);
    if (currentIndex + 1 < sessionCards.length) {
      setIsFlipped(false); 
      setFeedback(null);
      setVoiceMsg('');
      setWrongCount(0);
      setTimeout(() => setCurrentIndex(prev => prev + 1), 300);
    } else {
      trackSessionComplete();
      setScreen(SCREENS.SUMMARY);
    }
  };

  const startSession = async (withAudio = false) => {
    if (selectedSetIds.length === 0) return alert('Select a set!');
    const allCards = [];
    for (const id of selectedSetIds) {
      const res = await fetch(availableSets.find(s => s.id === id).url);
      const data = await res.json();
      const setCards = data.cards.map((c, index) => ({
        ...c,
        id: `${data.id}-${index}`
      }));
      allCards.push(...setCards);
    }
    const cards = getSessionCards(allCards, 20);
    setSessionCards(cards);
    setCurrentIndex(0);
    lastSpokenIndexRef.current = -1;
    setIsFlipped(false);
    setAudioEnabled(withAudio);
    setFeedback(null);
    setVoiceMsg('');
    setWrongCount(0);
    setSessionResults({ correct: 0, total: cards.length });
    setScreen(SCREENS.SET_SELECTION);
    };

    if (!serverUser && screen !== SCREENS.USER_SELECTION) {
    return (
      <div className="app">
        <h1>Welcome!</h1>
        <p>Please tell us who you are.</p>
        <form onSubmit={saveProfile} className="stat-card" style={{ maxWidth: '400px', margin: '2rem auto' }}>
          <div style={{ marginBottom: '1rem' }}>
            <input name="firstName" placeholder="First Name" required className="btn" style={{ background: 'white', color: 'black', border: '1px solid #ccc', width: '100%' }} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input name="lastName" placeholder="Last Name" required className="btn" style={{ background: 'white', color: 'black', border: '1px solid #ccc', width: '100%' }} />
          </div>
          <button type="submit" className="btn btn-correct">Save & Start</button>
        </form>
      </div>
    );
    }

    if (screen === SCREENS.USER_SELECTION) {
    return (
      <div className="app">
        <h1>Who is learning today?</h1>
        <div className="user-grid">
          {users.map(u => (
            <div key={u.id} className="user-avatar-container" onClick={() => selectUser(u)}>
              <div className="user-avatar">{u.name.charAt(0).toUpperCase()}</div>
              <p className="user-avatar-name">{u.name}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (screen === SCREENS.SET_SELECTION) {
    return (
      <div className="app">
        <h1>Hi {currentUser.name}!</h1>
        {greeting && <div className="ai-bubble"><p>{greeting}</p></div>}
        <p style={{ marginBottom: '1rem', color: '#666' }}>Select one or more sets to practice (max 20 cards total)</p>
        <div className="set-list">
          {availableSets.map(set => (
            <div key={set.id} className={`set-item-container ${selectedSetIds.includes(set.id) ? 'selected' : ''}`} onClick={() => {
              const next = selectedSetIds.includes(set.id) ? selectedSetIds.filter(sid => sid !== set.id) : [...selectedSetIds, set.id];
              setSelectedSetIds(next); setSelectedSets(next);
            }}>
              <div className="set-header"><h3>{set.title}</h3></div>
              <div className="set-body"><p className="set-description">{set.description}</p></div>
            </div>
          ))}
        </div>
        <div className="controls" style={{ marginTop: '2rem' }}>
          <button className="btn btn-correct" onClick={() => {
            // Prime speech synthesis for iOS/WebKit
            if (window.speechSynthesis) {
              const utterance = new SpeechSynthesisUtterance("");
              window.speechSynthesis.speak(utterance);
            }
            startSession(false);
          }}>Start Session</button>
          <button className="btn btn-correct" style={{ background: '#2196f3' }} onClick={() => {
            // Prime speech synthesis for iOS/WebKit
            if (window.speechSynthesis) {
              const utterance = new SpeechSynthesisUtterance("");
              window.speechSynthesis.speak(utterance);
            }
            startSession(true);
          }}>🔊 Audio Session</button>
        </div>
      </div>
    );
  }

  if (screen === SCREENS.SESSION) {
    const card = sessionCards[currentIndex];
    return (
      <div className="app">
        <div className="progress-bar"><div className="progress-inner" style={{ width: `${(currentIndex / sessionCards.length) * 100}%` }}></div></div>
        <div className="session-header">
          <p>Card {currentIndex + 1} of {sessionCards.length}</p>
          <div className={`listening-indicator ${isListening ? 'active' : ''}`}>{isListening ? 'Listening...' : 'Mic Off'}</div>
        </div>
        <div className="card-container" onClick={() => !isFlipped && setIsFlipped(true)}>
          <div className={`card ${isFlipped ? 'flipped' : ''} ${feedback === 'wrong' ? 'wrong-shake' : ''}`}>
            <div className="card-front">
              <div className="card-value" style={{ fontSize: getFontSize(card.front.value) }}>{card.front.value}</div>
              {card.front.description && (
                <>
                  <div className="card-divider"></div>
                  <div className="card-description" style={{ fontSize: `clamp(0.9rem, calc(${getFontSize(card.front.value)} * 0.5), 1.2rem)` }}>{card.front.description}</div>
                </>
              )}
            </div>
            <div className="card-back">
              <div className="card-value" style={{ fontSize: getFontSize(card.back.value) }}>{card.back.value}</div>
              {card.back.description && (
                <>
                  <div className="card-divider"></div>
                  <div className="card-description" style={{ fontSize: `clamp(0.9rem, calc(${getFontSize(card.back.value)} * 0.5), 1.2rem)` }}>{card.back.description}</div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="voice-status-msg">{voiceMsg}</div>
        {feedback === 'correct' && <div className="feedback-overlay">🌟</div>}
        {feedback === 'wrong' && <div className="feedback-overlay">❌</div>}
        {isFlipped && !feedback && (
          <div className="controls">
            <button className="btn btn-wrong" onClick={() => nextCard(1)}>Wrong</button>
            <button className="btn btn-correct" onClick={() => nextCard(4)}>Correct</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Well done, {currentUser.name}!</h1>
      {greeting && (
        <div className="ai-bubble" style={{background: '#e8f5e9', border: '1px solid #4caf50'}}>
          <p style={{fontSize: '1.4rem'}}>{greeting}</p>
        </div>
      )}
      <div className="stat-card" style={{maxWidth: '400px', margin: '2rem auto'}}>
        <p>That was session number <strong>{sessionsToday}</strong> for today.</p>
        <p>Your brain is getting stronger!</p>
      </div>

      {activityLog.length > 0 && (
        <div className="stat-card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'left' }}>
          <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Community Activity</h3>
          <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '1rem' }}>
            {activityLog.map((log, i) => {
              const details = JSON.parse(log.details || '{}');
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                  <div className="user-avatar" style={{ width: '40px', height: '40px', fontSize: '1rem', margin: 0 }}>
                    {(log.firstName || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p style={{ margin: 0 }}><strong>{log.firstName || 'User'}</strong> finished a session</p>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>
                      {details.accuracy}% accuracy • {new Date(log.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button className="btn btn-correct" onClick={() => { setGreeting(""); setScreen(SCREENS.SET_SELECTION); setLocalGreeting('start'); }}>Practice More</button>
    </div>
  );
}

export default App;
