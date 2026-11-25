import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays } from 'lucide-react';
import { allStories, getStory, thaiGiaoWeeks } from '../data/thaiGiao';
import ThaiGiaoLibrary from '../components/ThaiGiaoLibrary';
import ThaiGiaoStoryView from '../components/ThaiGiaoStoryView';
import DueDateSyncPrompt from '../components/DueDateSyncPrompt';
import {
  getHeaderAuth,
  onHeaderAuthChange,
  readCsrfCookie,
  refreshSession,
} from '../lib/wwwAuth';
import { createDueDateApi, decideDueDateSync } from '../lib/dueDateSync';
import './ThaiGiaoPage.css';

const STORAGE_KEYS = {
  DUE_DATE: 'ivf_thaigiao_due_date',
  READ_STORIES: 'ivf_thaigiao_read_stories',
  READING_PREFS: 'ivf_thaigiao_reading_prefs',
};

const MS_PER_DAY = 86400000;
const SYNC_LATER_STORAGE_KEY = 'ivf_thaigiao_due_sync_later_v1';
const SYNC_FAILED_NOTE =
  'Chưa lưu được lên tài khoản, ngày trên máy vẫn được giữ.';
const FULL_TERM_DAYS = 280;
const STORY_ID_PATTERN = /^w\d+-d[1-7]$/;

const DAY_LABELS = {
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
  7: 'Chủ Nhật',
};

const MEDICAL_DISCLAIMER =
  'Lưu ý y khoa: Các câu chuyện thai giáo và ghi chú phát triển thai kỳ trên trang này được biên soạn phục vụ mục đích giáo dục, thư giãn và gắn kết gia đình, hoàn toàn không phải tư vấn y khoa và không thay thế chẩn đoán hay chỉ định cá nhân hóa của bác sĩ sản phụ khoa. Khi có dấu hiệu bất thường trong thai kỳ, mẹ hãy liên hệ bác sĩ hoặc cơ sở y tế theo dõi ngay.';

const WORDS_PER_MINUTE = 105;
const SPEECH_WATCHDOG_GRACE_MS = 20000;
const SPEECH_WATCHDOG_MIN_MS = 30000;
const SPEECH_WATCHDOG_MAX_MS = 180000;

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function estimateSpeechTimeoutMs(text) {
  const words =
    typeof text === 'string'
      ? text.trim().split(/\s+/).filter(Boolean).length
      : 0;
  const estimatedSeconds = (words / WORDS_PER_MINUTE) * 60;
  const totalMs = estimatedSeconds * 1000 + SPEECH_WATCHDOG_GRACE_MS;
  return clamp(
    Math.round(totalMs),
    SPEECH_WATCHDOG_MIN_MS,
    SPEECH_WATCHDOG_MAX_MS,
  );
}

function parseStrictInt(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : null;
}

function parseIsoDate(raw) {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function getMondayToSundayDay(dateObj) {
  const jsDay = dateObj.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function computePregnancyFromDueDate(dueDateStr, minWeek, maxWeek, now = new Date()) {
  const parsed = parseIsoDate(dueDateStr);
  if (!parsed) {
    const defaultWeek = clamp(16, minWeek, maxWeek);
    return {
      hasDueDate: false,
      rawWeek: 16,
      week: defaultWeek,
      day: 1,
      isClamped: defaultWeek !== 16,
    };
  }

  const dueUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysRemaining = Math.round((dueUtc - todayUtc) / MS_PER_DAY);
  const gestationalDays = FULL_TERM_DAYS - daysRemaining;
  const rawWeek = Math.floor(gestationalDays / 7);
  const clampedWeek = clamp(rawWeek, minWeek, maxWeek);
  const day = clamp(getMondayToSundayDay(now), 1, 7);

  return {
    hasDueDate: true,
    rawWeek,
    week: clampedWeek,
    day,
    isClamped: rawWeek !== clampedWeek,
  };
}

function loadDueDate() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    const raw = window.localStorage.getItem(STORAGE_KEYS.DUE_DATE);
    return parseIsoDate(raw) ? raw.trim() : '';
  } catch {
    return '';
  }
}

function saveDueDate(value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (value) {
      window.localStorage.setItem(STORAGE_KEYS.DUE_DATE, value);
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.DUE_DATE);
    }
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}

function getSyncLaterUser() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return '';
    return window.sessionStorage.getItem(SYNC_LATER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setSyncLaterUser(userId) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(SYNC_LATER_STORAGE_KEY, userId);
  } catch {
    // Ignore storage errors
  }
}

function loadReadStories() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEYS.READ_STORIES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (item) => typeof item === 'string' && STORY_ID_PATTERN.test(item),
    );
    return Array.from(new Set(valid));
  } catch {
    return [];
  }
}

function saveReadStories(ids) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEYS.READ_STORIES, JSON.stringify(ids));
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}

function loadReadingPrefs() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { darkMode: false, largeText: false };
    }
    const raw = window.localStorage.getItem(STORAGE_KEYS.READING_PREFS);
    if (!raw) return { darkMode: false, largeText: false };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { darkMode: false, largeText: false };
    }
    return {
      darkMode: parsed.darkMode === true,
      largeText: parsed.largeText === true,
    };
  } catch {
    return { darkMode: false, largeText: false };
  }
}

function saveReadingPrefs(prefs) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      STORAGE_KEYS.READING_PREFS,
      JSON.stringify({
        darkMode: prefs.darkMode === true,
        largeText: prefs.largeText === true,
      }),
    );
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}

function detectSpeechSupport() {
  if (typeof window === 'undefined') return false;
  return (
    'speechSynthesis' in window &&
    window.speechSynthesis !== null &&
    typeof window.speechSynthesis.speak === 'function' &&
    typeof window.speechSynthesis.cancel === 'function' &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

function ThaiGiaoPage() {
  const prefersReducedMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  const weekBounds = useMemo(() => {
    if (thaiGiaoWeeks.length === 0) {
      return { minWeek: 16, maxWeek: 16 };
    }
    return {
      minWeek: thaiGiaoWeeks[0].week,
      maxWeek: thaiGiaoWeeks[thaiGiaoWeeks.length - 1].week,
    };
  }, []);

  const [dueDate, setDueDate] = useState(() => loadDueDate());
  const [readStoryList, setReadStoryList] = useState(() => loadReadStories());
  const [readingPrefs, setReadingPrefs] = useState(() => loadReadingPrefs());
  const [libraryWeekOverride, setLibraryWeekOverride] = useState(null);
  const [speechSupported] = useState(() => detectSpeechSupport());
  const [speakingStoryId, setSpeakingStoryId] = useState(null);
  const [auth, setAuth] = useState(() => getHeaderAuth());
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncPrompt, setSyncPrompt] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const mountedRef = useRef(true);
  const syncSeqRef = useRef(0);
  const dueDateRef = useRef(dueDate);
  dueDateRef.current = dueDate;
  const authRef = useRef(auth);
  authRef.current = auth;

  const dueDateApi = useMemo(
    () =>
      createDueDateApi({
        fetchImpl:
          typeof window !== 'undefined'
            ? window.fetch.bind(window)
            : undefined,
        readCsrf: readCsrfCookie,
        refresh: refreshSession,
      }),
    [],
  );

  const speechSessionRef = useRef(0);
  const speechTimerRef = useRef(null);
  const articleRef = useRef(null);
  const libraryRef = useRef(null);

  const currentPregnancy = useMemo(
    () =>
      computePregnancyFromDueDate(
        dueDate,
        weekBounds.minWeek,
        weekBounds.maxWeek,
      ),
    [dueDate, weekBounds.minWeek, weekBounds.maxWeek],
  );

  const tuanParam = searchParams.get('tuan');
  const ngayParam = searchParams.get('ngay');
  const hasQuerySelection = tuanParam !== null || ngayParam !== null;

  const parsedTuan = parseStrictInt(tuanParam);
  const parsedNgay = parseStrictInt(ngayParam);

  const selectedWeek =
    hasQuerySelection && parsedTuan !== null
      ? clamp(parsedTuan, weekBounds.minWeek, weekBounds.maxWeek)
      : currentPregnancy.week;

  const selectedDay =
    hasQuerySelection && parsedNgay !== null
      ? clamp(parsedNgay, 1, 7)
      : hasQuerySelection
        ? 1
        : currentPregnancy.day;

  const selectedStory = useMemo(
    () => getStory(selectedWeek, selectedDay),
    [selectedWeek, selectedDay],
  );

  const selectedWeekData = useMemo(
    () => thaiGiaoWeeks.find((item) => item.week === selectedWeek) ?? null,
    [selectedWeek],
  );

  const availableStoryIdSet = useMemo(
    () => new Set(allStories.map((story) => story.id)),
    [],
  );

  const readStoryIds = useMemo(
    () => new Set(readStoryList.filter((id) => availableStoryIdSet.has(id))),
    [readStoryList, availableStoryIdSet],
  );

  const currentStoryIndex = useMemo(() => {
    if (!selectedStory) return -1;
    return allStories.findIndex((item) => item.id === selectedStory.id);
  }, [selectedStory]);

  const prevStory =
    currentStoryIndex > 0 ? allStories[currentStoryIndex - 1] : null;
  const nextStory =
    currentStoryIndex >= 0 && currentStoryIndex < allStories.length - 1
      ? allStories[currentStoryIndex + 1]
      : null;

  const activeLibraryWeek =
    libraryWeekOverride !== null ? libraryWeekOverride : selectedWeek;

  const isSpeaking =
    speakingStoryId !== null && speakingStoryId === selectedStory?.id;

  const isViewingTodayStory =
    selectedWeek === currentPregnancy.week &&
    selectedDay === currentPregnancy.day;

  const clearSpeechTimer = useCallback(() => {
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
  }, []);

  const stopNarration = useCallback(() => {
    clearSpeechTimer();
    speechSessionRef.current += 1;
    setSpeakingStoryId(null);
    if (detectSpeechSupport()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech cancellation errors
      }
    }
  }, [clearSpeechTimer]);

  useEffect(() => {
    return () => {
      stopNarration();
    };
  }, [selectedStory?.id, stopNarration]);

  const scrollToElement = useCallback(
    (ref) => {
      if (!ref.current) return;
      ref.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [prefersReducedMotion],
  );

  const handleSelectStory = useCallback(
    (week, day, shouldScroll = true) => {
      const targetWeek = clamp(week, weekBounds.minWeek, weekBounds.maxWeek);
      const targetDay = clamp(day, 1, 7);
      stopNarration();
      setLibraryWeekOverride(null);
      setSearchParams({
        tuan: String(targetWeek),
        ngay: String(targetDay),
      });
      if (shouldScroll) {
        scrollToElement(articleRef);
      }
    },
    [
      weekBounds.minWeek,
      weekBounds.maxWeek,
      stopNarration,
      setSearchParams,
      scrollToElement,
    ],
  );

  const applyServerDueDate = useCallback(
    (serverValue) => {
      if (!serverValue || !parseIsoDate(serverValue)) return;
      stopNarration();
      setLibraryWeekOverride(null);
      setDueDate(serverValue);
      saveDueDate(serverValue);
      const computed = computePregnancyFromDueDate(
        serverValue,
        weekBounds.minWeek,
        weekBounds.maxWeek,
      );
      setSearchParams({
        tuan: String(computed.week),
        ngay: String(computed.day),
      });
    },
    [stopNarration, weekBounds.minWeek, weekBounds.maxWeek, setSearchParams],
  );

  useEffect(() => {
    mountedRef.current = true;
    const syncAuth = () => {
      if (!mountedRef.current) return;
      const next = getHeaderAuth();
      setAuth((prev) =>
        prev.state === next.state && prev.userId === next.userId ? prev : next,
      );
    };
    syncAuth();
    const unsubscribe = onHeaderAuthChange(syncAuth);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    syncSeqRef.current += 1;
    const reqSeq = syncSeqRef.current;

    setSyncPrompt(null);
    setSyncBusy(false);
    setSyncNote('');

    if (auth.state !== 'signed-in' || !auth.userId) {
      setSyncStatus('idle');
      return;
    }

    const userId = auth.userId;
    setSyncStatus('idle');

    (async () => {
      const result = await dueDateApi.get();
      if (!mountedRef.current || reqSeq !== syncSeqRef.current) return;

      if (result.kind !== 'ok') {
        setSyncStatus('local');
        return;
      }

      const currentLocal = dueDateRef.current;
      const decision = decideDueDateSync({
        local: currentLocal,
        server: result.dueDate,
      });

      if (decision === 'in_sync' || decision === 'none') {
        setSyncStatus('synced');
        return;
      }

      if (decision === 'apply_server') {
        applyServerDueDateRef.current(result.dueDate);
        setSyncStatus('synced');
        return;
      }

      if (getSyncLaterUser() === userId) {
        setSyncStatus('local');
        return;
      }

      setSyncStatus('local');
      setSyncPrompt({
        kind: decision,
        localDate: currentLocal,
        serverDate: result.dueDate || '',
      });
    })();
  }, [auth.state, auth.userId, dueDateApi]);

  const applyServerDueDateRef = useRef(applyServerDueDate);
  applyServerDueDateRef.current = applyServerDueDate;

  const handleUseServerDate = () => {
    if (!syncPrompt?.serverDate) return;
    applyServerDueDate(syncPrompt.serverDate);
    setSyncPrompt(null);
    setSyncNote('');
    setSyncStatus('synced');
  };

  const handleUseLocalDate = async () => {
    if (!syncPrompt || syncBusy) return;
    const targetDate = syncPrompt.localDate;
    const reqSeq = ++syncSeqRef.current;

    setSyncBusy(true);
    setSyncNote('');
    const result = await dueDateApi.put(targetDate || null);
    if (!mountedRef.current || reqSeq !== syncSeqRef.current) return;
    setSyncBusy(false);
    setSyncPrompt(null);
    if (result.kind === 'ok') {
      setSyncStatus('synced');
    } else {
      setSyncStatus('local');
      setSyncNote(SYNC_FAILED_NOTE);
    }
  };

  const handleLaterSync = () => {
    if (authRef.current?.userId) {
      setSyncLaterUser(authRef.current.userId);
    }
    setSyncPrompt(null);
    setSyncStatus('local');
  };

  const syncPutIfSynced = (nextValue) => {

    if (
      syncStatus !== 'synced' ||
      auth.state !== 'signed-in' ||
      !auth.userId
    ) {
      return;
    }
    setSyncNote('');
    const reqSeq = ++syncSeqRef.current;
    dueDateApi.put(nextValue).then((result) => {
      if (!mountedRef.current || reqSeq !== syncSeqRef.current) return;
      if (result.kind !== 'ok') {
        setSyncStatus('local');
        setSyncNote(SYNC_FAILED_NOTE);
      }
    });
  };

  const handleDueDateChange = (event) => {
    const nextValue = event.target.value;
    stopNarration();
    setLibraryWeekOverride(null);

    if (!nextValue) {
      setDueDate('');
      saveDueDate('');
      setSearchParams({});
    syncPutIfSynced(null);
      return;
    }

    if (!parseIsoDate(nextValue)) {
      return;
    }

    setDueDate(nextValue);
    saveDueDate(nextValue);
    syncPutIfSynced(nextValue);
    const computed = computePregnancyFromDueDate(
      nextValue,
      weekBounds.minWeek,
      weekBounds.maxWeek,
    );
    setSearchParams({
      tuan: String(computed.week),
      ngay: String(computed.day),
    });
  };

  const handleClearDueDate = () => {
    stopNarration();
    setLibraryWeekOverride(null);
    setDueDate('');
    saveDueDate('');
    setSearchParams({});
    syncPutIfSynced(null);
  };

  const handleToggleRead = (storyId) => {
    if (typeof storyId !== 'string' || !STORY_ID_PATTERN.test(storyId)) return;
    setReadStoryList((prev) => {
      const exists = prev.includes(storyId);
      const next = exists
        ? prev.filter((id) => id !== storyId)
        : [...prev, storyId];
      saveReadStories(next);
      return next;
    });
  };

  const handleToggleDarkMode = () => {
    setReadingPrefs((prev) => {
      const next = { ...prev, darkMode: !prev.darkMode };
      saveReadingPrefs(next);
      return next;
    });
  };

  const handleToggleLargeText = () => {
    setReadingPrefs((prev) => {
      const next = { ...prev, largeText: !prev.largeText };
      saveReadingPrefs(next);
      return next;
    });
  };

  const handleToggleSpeech = () => {
    if (!speechSupported || !selectedStory) return;

    if (isSpeaking) {
      stopNarration();
      return;
    }

    if (speakingStoryId !== null) {
      stopNarration();
    }

    const segments = [
      selectedStory.title,
      ...(Array.isArray(selectedStory.blocks)
        ? selectedStory.blocks
            .map((block) =>
              block && typeof block.text === 'string' ? block.text.trim() : '',
            )
            .filter(Boolean)
        : []),
    ];

    if (segments.length === 0) return;

    clearSpeechTimer();

    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const sessionId = speechSessionRef.current + 1;
      speechSessionRef.current = sessionId;
      setSpeakingStoryId(selectedStory.id);

      const voices =
        typeof synth.getVoices === 'function' ? synth.getVoices() : [];
      const viVoice = voices.find(
        (voice) =>
          typeof voice.lang === 'string' &&
          voice.lang.toLowerCase().startsWith('vi'),
      );

      const speakAt = (index) => {
        if (speechSessionRef.current !== sessionId) {
          return;
        }
        if (index >= segments.length) {
          clearSpeechTimer();
          setSpeakingStoryId(null);
          return;
        }

        clearSpeechTimer();

        try {
          const segmentText = segments[index];
          const timeoutMs = estimateSpeechTimeoutMs(segmentText);

          speechTimerRef.current = setTimeout(() => {
            if (speechSessionRef.current !== sessionId) return;
            speechSessionRef.current += 1;
            speechTimerRef.current = null;
            setSpeakingStoryId(null);
            if (detectSpeechSupport()) {
              try {
                window.speechSynthesis.cancel();
              } catch {
                // Ignore speech cancellation errors
              }
            }
          }, timeoutMs);

          const utterance = new window.SpeechSynthesisUtterance(segmentText);
          utterance.lang = viVoice?.lang || 'vi-VN';
          if (viVoice) {
            utterance.voice = viVoice;
          }
          utterance.rate = 0.95;
          utterance.pitch = 1;
          utterance.onend = () => {
            if (speechSessionRef.current !== sessionId) return;
            clearSpeechTimer();
            speakAt(index + 1);
          };
          utterance.onerror = () => {
            if (speechSessionRef.current !== sessionId) return;
            speechSessionRef.current += 1;
            clearSpeechTimer();
            setSpeakingStoryId(null);
            if (detectSpeechSupport()) {
              try {
                window.speechSynthesis.cancel();
              } catch {
                // Ignore speech cancellation errors
              }
            }
          };
          synth.speak(utterance);
        } catch {
          if (speechSessionRef.current === sessionId) {
            speechSessionRef.current += 1;
            clearSpeechTimer();
            setSpeakingStoryId(null);
            if (detectSpeechSupport()) {
              try {
                window.speechSynthesis.cancel();
              } catch {
                // Ignore speech cancellation errors
              }
            }
          }
        }
      };

      speakAt(0);
    } catch {
      clearSpeechTimer();
      speechSessionRef.current += 1;
      setSpeakingStoryId(null);
      if (detectSpeechSupport()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore speech cancellation errors
        }
      }
    }
  };

  const pageClasses = [
    'tg-page',
    readingPrefs.darkMode ? 'tg-reading-dark' : '',
    readingPrefs.largeText ? 'tg-reading-large' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const weekRangeLabel =
    weekBounds.minWeek === weekBounds.maxWeek
      ? `Tuần ${weekBounds.minWeek}`
      : `Tuần ${weekBounds.minWeek}–${weekBounds.maxWeek}`;

  return (
    <div className={pageClasses}>
      <div className="tg-shell">
        <nav className="tg-top-nav" aria-label="Điều hướng trang">
          <Link to="/" className="tg-back-link">
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Quay lại Hành trình</span>
          </Link>

          <a
            href="#tg-library"
            className="tg-jump-link"
            onClick={(event) => {
              event.preventDefault();
              scrollToElement(libraryRef);
            }}
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>Thư viện ({allStories.length})</span>
          </a>
        </nav>

        <header className="tg-hero">
          <p className="tg-section-eyebrow">
            Truyện thai giáo mỗi tối · Dịu nhẹ &amp; gắn kết
          </p>
          <h1 className="tg-page-title">Thai Giáo Cùng Con Yêu</h1>
          <p className="tg-page-subtitle">
            Mỗi tối 10–12 phút đọc chậm rãi cùng con theo từng tuần phát triển của
            thai kỳ. Lưu lại tiến độ đọc, tùy chỉnh ánh sáng ban đêm và bật chế độ
            nghe đọc khi mẹ muốn nghỉ mắt.
          </p>

          <section
            className="tg-due-panel"
            aria-labelledby="tg-due-heading"
          >
            <div className="tg-due-status-col">
              <p id="tg-due-heading" className="tg-due-kicker">
                <CalendarDays size={16} aria-hidden="true" />
                <span>Mốc thai kỳ hiện tại</span>
              </p>

              <div className="tg-current-week-row">
                <span className="tg-current-week-badge">
                  Tuần {currentPregnancy.week} · Ngày {currentPregnancy.day}
                </span>
                <span className="tg-current-day-name">
                  {DAY_LABELS[currentPregnancy.day]}
                </span>
              </div>

              {!currentPregnancy.hasDueDate ? (
                <p className="tg-due-hint">
                  Chưa cài ngày dự sinh — hệ thống đang hiển thị mặc định{' '}
                  <strong>
                    Tuần {currentPregnancy.week} · Ngày {currentPregnancy.day}
                  </strong>
                  . Bố mẹ có thể nhập ngày dự sinh bên cạnh để tự động tính đúng
                  tuần thai hiện tại.
                </p>
              ) : currentPregnancy.isClamped ? (
                <p className="tg-due-hint">
                  {currentPregnancy.rawWeek < 1 ? (
                    <>
                      Ngày dự sinh hiện nằm ngoài chu kỳ 40 tuần — thư viện hiện có{' '}
                      <strong>{weekRangeLabel}</strong>, đang gợi ý{' '}
                      <strong>
                        Tuần {currentPregnancy.week} · Ngày {currentPregnancy.day}
                      </strong>
                      .
                    </>
                  ) : (
                    <>
                      Thai kỳ ước tính theo ngày dự sinh là{' '}
                      <strong>Tuần {currentPregnancy.rawWeek}</strong> (thư viện hiện
                      có {weekRangeLabel}, đang hiển thị Tuần{' '}
                      {currentPregnancy.week}).
                    </>
                  )}
                </p>
              ) : (
                <p className="tg-due-hint">
                  Tính tự động theo ngày dự sinh đã lưu (thứ Hai đến Chủ Nhật tương
                  ứng Ngày 1–7).
                </p>
              )}

              {!isViewingTodayStory ? (
                <button
                  type="button"
                  className="tg-today-btn"
                  onClick={() =>
                    handleSelectStory(
                      currentPregnancy.week,
                      currentPregnancy.day,
                    )
                  }
                >
                  <span>
                    Về truyện hôm nay (Tuần {currentPregnancy.week} · Ngày{' '}
                    {currentPregnancy.day})
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="tg-due-input-col">
              <label htmlFor="tg-due-date" className="tg-due-label">
                Ngày dự sinh (EDD)
              </label>
              <div className="dds-input-wrap">
              <div className="tg-due-input-row">
                <input
                  id="tg-due-date"
                  type="date"
                  className="tg-due-input"
                  value={dueDate}
                  onChange={handleDueDateChange}
                />
                {dueDate ? (
                  <button
                    type="button"
                    className="tg-clear-date-btn"
                    onClick={handleClearDueDate}
                  >
                    Xóa
                  </button>
                ) : null}
              </div>
              {syncStatus === 'synced' ? (
                <p className="dds-status">Đã lưu theo tài khoản YunDev</p>
              ) : null}
              {syncNote ? (
                <p className="dds-note" role="status">
                  {syncNote}
                </p>
              ) : null}
              {syncPrompt ? (
                <DueDateSyncPrompt
                  kind={syncPrompt.kind}
                  localDate={syncPrompt.localDate}
                  serverDate={syncPrompt.serverDate}
                  busy={syncBusy}
                  onUseServer={handleUseServerDate}
                  onUseLocal={handleUseLocalDate}
                  onLater={handleLaterSync}
                />
              ) : null}
              </div>
            </div>
          </section>
        </header>

        {selectedWeekData ? (
          <section
            className="tg-week-context"
            aria-labelledby="tg-week-theme-heading"
          >
            <div className="tg-week-context-top">
              <span className="tg-week-context-pill">
                Tuần thai {selectedWeekData.week}
              </span>
              <h2 id="tg-week-theme-heading" className="tg-week-theme-title">
                Chủ đề: {selectedWeekData.theme}
              </h2>
            </div>
            <p className="tg-week-note-text">
              {selectedWeekData.developmentalNote}
            </p>
          </section>
        ) : null}

        <main id="journey-main" className="tg-main">
          <ThaiGiaoStoryView
            story={selectedStory}
            dayLabel={DAY_LABELS[selectedDay] || ''}
            isRead={selectedStory ? readStoryIds.has(selectedStory.id) : false}
            onToggleRead={handleToggleRead}
            isDarkMode={readingPrefs.darkMode}
            onToggleDarkMode={handleToggleDarkMode}
            isLargeText={readingPrefs.largeText}
            onToggleLargeText={handleToggleLargeText}
            speechSupported={speechSupported}
            isSpeaking={isSpeaking}
            onToggleSpeech={handleToggleSpeech}
            prevStory={prevStory}
            nextStory={nextStory}
            onSelectStory={handleSelectStory}
            onScrollToLibrary={() => scrollToElement(libraryRef)}
            requestedWeek={selectedWeek}
            requestedDay={selectedDay}
            articleRef={articleRef}
          />

          <ThaiGiaoLibrary
            weeks={thaiGiaoWeeks}
            activeLibraryWeek={activeLibraryWeek}
            onSelectLibraryWeek={(weekNum) => setLibraryWeekOverride(weekNum)}
            selectedStoryId={selectedStory?.id ?? null}
            readStoryIds={readStoryIds}
            onSelectStory={handleSelectStory}
            onToggleRead={handleToggleRead}
            dayLabels={DAY_LABELS}
            totalStoryCount={allStories.length}
            libraryRef={libraryRef}
          />
        </main>

        <footer
          className="tg-disclaimer-footer"
          aria-label="Lưu ý y khoa và phạm vi tham khảo"
        >
          <h2 className="tg-disclaimer-title">
            Lưu ý y khoa &amp; Phạm vi tham khảo
          </h2>
          <p className="tg-disclaimer-text">{MEDICAL_DISCLAIMER}</p>
        </footer>
      </div>
    </div>
  );
}

export default ThaiGiaoPage;