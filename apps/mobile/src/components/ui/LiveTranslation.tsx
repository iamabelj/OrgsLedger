// ============================================================
// OrgsLedger — Live Voice Translation Component
// Real-time speech recognition + multi-language translation
// 100+ languages via dynamic ISO registry + GPT translation
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Animated,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import { socketClient } from '../../api/socket';
import { api } from '../../api/client';
import { showAlert } from '../../utils/alert';
import { useMeetingStore } from '../../stores/meeting.store';

// ── Dynamic Language Registry (100+ languages) ────────────
import {
  ALL_LANGUAGES,
  LANGUAGES,
  LANG_FLAGS,
  SPEECH_CODES,
  TTS_SUPPORTED,
  isTtsSupported,
  getLanguageFlag,
  getBcp47,
  getLanguageName,
  isRtl,
} from '../../utils/languages';
import type { Language } from '../../utils/languages';

// Re-export for backward compat with other files
export { LANGUAGES, LANG_FLAGS };

interface TranslationEntry {
  id: string;
  speakerName: string;
  speakerId: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  timestamp: number;
}

interface Participant {
  userId: string;
  name: string;
  language: string;
}

export interface LiveTranslationRef {
  startListening: () => void;
  stopListening: () => void;
  selectLanguage: (lang: string) => void;
  isListening: () => boolean;
  getLanguage: () => string;
  setAutoTTS: (enabled: boolean) => void;
}

interface LiveTranslationProps {
  meetingId: string;
  userId: string;
  hideControls?: boolean;
  autoTTS?: boolean; // Enable voice-to-voice: auto-speak translated text
}

const LiveTranslation = React.forwardRef<LiveTranslationRef, LiveTranslationProps>(
  function LiveTranslation({ meetingId, userId, hideControls = false, autoTTS = false }, ref) {
  const [myLanguage, setMyLanguage] = useState('en');
  const [isListening, setIsListening] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(true); // Show on first join so members pick their language
  const [hasChosenLanguage, setHasChosenLanguage] = useState(false);
  const [translations, setTranslations] = useState<TranslationEntry[]>([]);
  const [interimText, setInterimText] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [speakEnabled, setSpeakEnabled] = useState(autoTTS);
  const [isExpanded, setIsExpanded] = useState(true);
  const [ttsVolume, setTtsVolume] = useState(0.8); // Voice-to-voice volume control
  const [langSearch, setLangSearch] = useState(''); // Searchable language picker
  const [ttsWarmedUp, setTtsWarmedUp] = useState(false); // Chrome TTS warm-up state

  // Sync autoTTS prop from parent (e.g., Voice-to-Voice toggle in control bar)
  useEffect(() => { setSpeakEnabled(autoTTS); }, [autoTTS]);

  // ── Chrome TTS warm-up ─────────────────────────────────
  // Chrome loads voices asynchronously and requires a user gesture
  // to unlock speechSynthesis. Warm up on first user interaction.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    // Load voices (Chrome fires this event asynchronously)
    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        console.debug(`[TTS] ${voices.length} voices loaded`);
      }
    };
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);

    // Warm up TTS with a silent utterance on first user click
    // This unlocks Chrome's autoplay restriction for speechSynthesis
    const warmUp = () => {
      if (ttsWarmedUp) return;
      try {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        synth.speak(silent);
        setTtsWarmedUp(true);
        console.debug('[TTS] Warmed up — audio unlocked');
      } catch { /* non-critical */ }
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
    };
    document.addEventListener('click', warmUp, { once: true });
    document.addEventListener('touchstart', warmUp, { once: true });

    return () => {
      synth.removeEventListener('voiceschanged', loadVoices);
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
    };
  }, [ttsWarmedUp]);

  // Zustand store sync — keep centralized state updated
  const storeSetMyLanguage = useMeetingStore((s) => s.setMyLanguage);
  const storeAddTranslation = useMeetingStore((s) => s.addTranslation);
  const storeSetInterimText = useMeetingStore((s) => s.setInterimText);
  const storeSetTranslationParticipants = useMeetingStore((s) => s.setTranslationParticipants);

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const entriesRef = useRef<TranslationEntry[]>([]);
  const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep entries ref in sync
  useEffect(() => {
    entriesRef.current = translations;
  }, [translations]);

  // ── Pulse animation for recording ──────────────────────
  useEffect(() => {
    if (isListening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isListening]);

  // ── Socket event listeners ─────────────────────────────
  useEffect(() => {
    const unsubParticipants = socketClient.on('translation:participants', (data: any) => {
      if (data.meetingId === meetingId) {
        setParticipants(data.participants || []);
        storeSetTranslationParticipants(data.participants || []);
      }
    });

    // Auto-restore saved language preference from server
    const unsubRestored = socketClient.on('translation:language-restored', (data: any) => {
      if (data.meetingId === meetingId && data.language) {
        console.debug('[TRANSLATION] Language restored from server:', data.language);
        setMyLanguage(data.language);
        setHasChosenLanguage(true);
        setShowLanguagePicker(false);
        storeSetMyLanguage(data.language);
        if (data.receiveVoice !== undefined) {
          setSpeakEnabled(data.receiveVoice);
        }
      }
    });

    const unsubResult = socketClient.on('translation:result', (data: any) => {
      if (data.meetingId !== meetingId) return;

      const myLang = myLanguageRef.current;
      const translated = data.translations?.[myLang] || data.originalText;

      const entryId = `${data.speakerId}-${data.timestamp}`;

      const entry: TranslationEntry = {
        id: entryId,
        speakerName: data.speakerName,
        speakerId: data.speakerId,
        originalText: data.originalText,
        translatedText: translated,
        sourceLang: data.sourceLang,
        timestamp: data.timestamp,
      };

      setTranslations((prev) => {
        // Dedup: skip if entry with same id already exists
        if (prev.some((e) => e.id === entryId)) return prev;
        const next = [...prev, entry].slice(-50); // Keep last 50
        return next;
      });
      setInterimText('');
      // Sync to Zustand store
      storeAddTranslation(entry);
      storeSetInterimText('');

      // Text-to-speech for received translations (not own speech)
      // Voice-to-voice: only when server says TTS is available for this user's language
      if (data.speakerId !== userId) {
        const shouldSpeak = speakEnabledRef.current && data.ttsAvailable;
        console.debug(`[TTS] Received translation — speakEnabled=${speakEnabledRef.current}, ttsAvailable=${data.ttsAvailable}, shouldSpeak=${shouldSpeak}, text="${translated?.slice(0, 40)}"`);
        if (shouldSpeak && translated) {
          speak(translated, myLang);
        }
      }

      // Auto-scroll
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });

    const unsubInterim = socketClient.on('translation:interim', (data: any) => {
      if (data.meetingId === meetingId && data.speakerId !== userId) {
        setInterimText(`${data.speakerName}: ${data.text}`);
        storeSetInterimText(`${data.speakerName}: ${data.text}`);
      }
    });

    const unsubAudioError = socketClient.on('audio:error', (data: any) => {
      if (data.meetingId === meetingId) {
        console.warn('[STT] Server audio error:', data.error);
      }
    });

    return () => {
      unsubParticipants();
      unsubRestored();
      unsubResult();
      unsubInterim();
      unsubAudioError();
    };
  }, [meetingId, userId]);

  // Refs for latest values inside callbacks
  const myLanguageRef = useRef(myLanguage);
  const speakEnabledRef = useRef(speakEnabled);
  useEffect(() => { myLanguageRef.current = myLanguage; }, [myLanguage]);
  useEffect(() => { speakEnabledRef.current = speakEnabled; }, [speakEnabled]);

  // ── Set language and notify server ─────────────────────
  const selectLanguage = useCallback((lang: string) => {
    setMyLanguage(lang);
    setShowLanguagePicker(false);
    setHasChosenLanguage(true);
    setLangSearch('');
    // Send receiveVoice preference along with language
    socketClient.emit('translation:set-language', {
      meetingId,
      language: lang,
      receiveVoice: speakEnabledRef.current,
    });
    storeSetMyLanguage(lang);
  }, [meetingId]);

  // Initialize: set default language on mount (include receiveVoice preference)
  // Delayed to allow server's language-restored event to arrive first
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only emit if language hasn't been restored from server
      if (!hasChosenLanguage) {
        socketClient.emit('translation:set-language', {
          meetingId,
          language: myLanguage,
          receiveVoice: speakEnabledRef.current,
        });
      }
    }, 500); // Give language-restored event 500ms to arrive
    return () => clearTimeout(timer);
  }, [meetingId]);

  // ── Server-Side STT via Audio Streaming ─────────────────
  // Web: MediaRecorder → audio/webm;codecs=opus → server → Google STT
  // Mobile: Future native audio module support
  const startListening = useCallback(async () => {
    if (Platform.OS === 'web') {
      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        // Check for MediaRecorder + webm support
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });

        // Tell server to start a Google STT session for this user
        socketClient.startAudioStream(meetingId, myLanguageRef.current, 'WEBM_OPUS');

        recorder.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) {
            e.data.arrayBuffer().then((buffer: ArrayBuffer) => {
              socketClient.sendAudioChunk(meetingId, buffer);
            });
          }
        };

        recorder.onerror = (e: any) => {
          console.warn('[AUDIO] MediaRecorder error:', e);
        };

        // Send audio chunks every 250ms
        recorder.start(250);
        recognitionRef.current = { recorder, stream };
        setIsListening(true);

        console.debug(`[AUDIO] Started audio capture: mimeType=${mimeType}, meeting=${meetingId}`);
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') {
          showAlert('Microphone Blocked', 'Please allow microphone access in your browser settings.');
        } else {
          console.warn('[AUDIO] Failed to start audio capture:', err);
          showAlert('Audio Error', 'Could not access microphone. Check browser permissions.');
        }
      }
      return;
    }

    // Native mobile (React Native) — future: integrate native audio module
    showAlert('Coming Soon', 'Native audio transcription is being developed. Use the web version for now.');
  }, [meetingId, myLanguage]);

  const stopListening = useCallback(() => {
    const ref = recognitionRef.current;
    recognitionRef.current = null;

    if (ref) {
      if (Platform.OS === 'web' && ref.recorder) {
        try { ref.recorder.stop(); } catch (_) {}
        try { ref.stream?.getTracks().forEach((t: any) => t.stop()); } catch (_) {}
      }
      // Tell server to stop the STT session
      socketClient.stopAudioStream(meetingId);
    }

    setIsListening(false);
    setInterimText('');
  }, [meetingId]);

  // ── Expose control API to parent via ref ────────────────
  React.useImperativeHandle(ref, () => ({
    startListening,
    stopListening,
    selectLanguage,
    isListening: () => isListening,
    getLanguage: () => myLanguage,
    setAutoTTS: (enabled: boolean) => setSpeakEnabled(enabled),
  }), [startListening, stopListening, selectLanguage, isListening, myLanguage]);

  // ── Text-to-Speech (Web + Android + iOS) — Voice-to-Voice ──
  // Private per-user: TTS is played locally only, does NOT override meeting audio
  const speak = useCallback((text: string, lang: string) => {
    // Check TTS support before attempting
    if (!isTtsSupported(lang)) {
      // Language has no TTS voice — text-only translation, skip voice
      console.debug(`[TTS] TTS not available for ${lang}, text-only fallback`);
      return;
    }

    const langCode = getBcp47(lang) || 'en-US';
    try {
      if (Platform.OS === 'web') {
        const synth = window.speechSynthesis;
        if (!synth) {
          console.warn('[TTS] speechSynthesis not available');
          return;
        }
        // Cancel queued speech first
        synth.cancel();
        // Chrome quirk: after cancel(), must wait a tick before speak()
        // otherwise the engine can get stuck in a "paused" state
        setTimeout(() => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = langCode;
          utterance.rate = 1.0;
          utterance.volume = ttsVolume;
          utterance.pitch = 1.0;

          // Try to find a matching voice (Chrome doesn't auto-match well)
          const voices = synth.getVoices();
          const match = voices.find((v) => v.lang.startsWith(langCode.split('-')[0]));
          if (match) utterance.voice = match;

          utterance.onerror = (e: any) => {
            console.warn('[TTS] Utterance error:', e.error || e);
          };
          utterance.onend = () => {
            console.debug('[TTS] Utterance complete');
          };

          synth.speak(utterance);
          console.debug(`[TTS] Speaking: "${text.slice(0, 40)}..." lang=${langCode}`);
        }, 50);
      } else {
        // Cancel previous speech on native for cleaner voice-to-voice
        Speech.stop();
        Speech.speak(text, {
          language: langCode,
          rate: 1.0,
          pitch: 1.0,
          volume: ttsVolume,
          onError: (err) => console.warn('TTS failed', err),
        });
      }
    } catch (e) {
      console.warn('TTS failed', e);
    }
  }, [ttsVolume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      if (Platform.OS === 'web') {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      } else {
        Speech.stop();
      }
    };
  }, []);

  const selectedFlag = getLanguageFlag(myLanguage);
  const selectedName = getLanguageName(myLanguage);

  // ── Filtered language list (searchable, memoized) ──────
  const filteredLanguages = useMemo(() => {
    if (!langSearch.trim()) return ALL_LANGUAGES;
    const q = langSearch.toLowerCase().trim();
    return ALL_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [langSearch]);

  return (
    <View style={styles.container}>
      {/* ── Header Bar ───────────────────────────────────── */}
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <Ionicons name="language" size={20} color={Colors.highlight} />
          <Text style={styles.headerTitle}>Live Translation</Text>
          {isListening && (
            <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
          )}
        </View>
        <View style={styles.headerRight}>
          {participants.length > 0 && (
            <View style={styles.participantCount}>
              <Ionicons name="people" size={12} color={Colors.textLight} />
              <Text style={styles.participantCountText}>{participants.length}</Text>
            </View>
          )}
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textLight} />
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          {!hideControls && (<>
          {/* ── Language Selector + Controls ────────────────── */}
          <View style={styles.controls}>
            <TouchableOpacity style={styles.langButton} onPress={() => setShowLanguagePicker(!showLanguagePicker)} activeOpacity={0.7}>
              <Text style={styles.langFlag}>{selectedFlag}</Text>
              <Text style={styles.langName}>{selectedName}</Text>
              <Ionicons name="caret-down" size={12} color={Colors.textLight} />
            </TouchableOpacity>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.ttsButton, speakEnabled && styles.ttsActive]}
                onPress={() => setSpeakEnabled(!speakEnabled)}
                activeOpacity={0.7}
              >
                <Ionicons name={speakEnabled ? 'volume-high' : 'volume-mute'} size={18} color={speakEnabled ? Colors.highlight : Colors.textLight} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.micButton, isListening && styles.micActive]}
                onPress={isListening ? stopListening : startListening}
                activeOpacity={0.7}
              >
                <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#FFF' : Colors.highlight} />
                <Text style={[styles.micText, isListening && { color: '#FFF' }]}>
                  {isListening ? 'Listening...' : 'Speak'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Language Picker Dropdown (Searchable, 100+ languages) ── */}
          {showLanguagePicker && (
            <View style={styles.langDropdown}>
              {!hasChosenLanguage ? (
                <View style={styles.welcomeBanner}>
                  <Ionicons name="language" size={24} color={Colors.highlight} />
                  <Text style={styles.welcomeTitle}>Choose Your Language</Text>
                  <Text style={styles.welcomeHint}>
                    Select the language you speak. You'll hear others translated into your language in real-time.
                  </Text>
                </View>
              ) : (
                <Text style={styles.dropdownTitle}>Change Language</Text>
              )}

              {/* Search input */}
              <View style={styles.langSearchWrap}>
                <Ionicons name="search" size={16} color={Colors.textLight} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.langSearchInput}
                  placeholder="Search language..."
                  placeholderTextColor={Colors.textLight}
                  value={langSearch}
                  onChangeText={setLangSearch}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {langSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setLangSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color={Colors.textLight} />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView
                style={{ maxHeight: hasChosenLanguage ? 250 : 340 }}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                {filteredLanguages.length === 0 && (
                  <Text style={styles.noResults}>No languages match "{langSearch}"</Text>
                )}
                {filteredLanguages.map((lang) => {
                  const isSelected = myLanguage === lang.code;
                  const hasTts = isTtsSupported(lang.code);
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[styles.langOption, isSelected && styles.langOptionActive]}
                      onPress={() => selectLanguage(lang.code)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.langOptionFlag}>{lang.flag || '🌐'}</Text>
                      <View style={{ flex: 1, marginLeft: 4 }}>
                        <Text style={[styles.langOptionName, isSelected && { color: Colors.highlight }]}>
                          {lang.name}
                        </Text>
                        {lang.nativeName !== lang.name && (
                          <Text style={styles.langNativeName}>{lang.nativeName}</Text>
                        )}
                      </View>
                      {hasTts ? (
                        <Ionicons name="volume-medium-outline" size={14} color={Colors.textLight} style={{ marginRight: 4 }} />
                      ) : (
                        <Ionicons name="document-text-outline" size={14} color={Colors.textLight} style={{ marginRight: 4 }} />
                      )}
                      {isSelected && <Ionicons name="checkmark" size={16} color={Colors.highlight} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
          </>)}

          {/* ── Participant Languages ──────────────────────── */}
          {participants.length > 0 && (
            <View style={styles.participantsBar}>
              {participants.map((p) => (
                <View key={p.userId} style={styles.participantChip}>
                  <Text style={styles.chipFlag}>{getLanguageFlag(p.language)}</Text>
                  <Text style={styles.chipName} numberOfLines={1}>
                    {p.userId === userId ? 'You' : p.name.split(' ')[0]}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Translation Feed ───────────────────────────── */}
          <ScrollView
            ref={scrollRef}
            style={styles.feed}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={translations.length === 0 ? styles.feedEmpty : undefined}
          >
            {translations.length === 0 && !interimText && (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={32} color={Colors.textLight} />
                <Text style={styles.emptyText}>
                  Select your language and tap "Speak" to start.{'\n'}
                  Everyone's speech will be translated in real-time.
                </Text>
              </View>
            )}

            {translations.map((entry) => {
              const isMe = entry.speakerId === userId;
              return (
                <View key={entry.id} style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <View style={styles.bubbleHeader}>
                    <Text style={styles.bubbleSpeaker}>
                      {getLanguageFlag(entry.sourceLang)} {isMe ? 'You' : entry.speakerName}
                    </Text>
                    <Text style={styles.bubbleTime}>
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={styles.bubbleText}>{entry.translatedText}</Text>
                  {entry.sourceLang !== myLanguage && (
                    <Text style={styles.bubbleOriginal}>
                      Original: {entry.originalText}
                    </Text>
                  )}
                </View>
              );
            })}

            {/* Interim text indicator */}
            {interimText ? (
              <View style={[styles.bubble, styles.bubbleInterim]}>
                <Text style={styles.interimDots}>...</Text>
                <Text style={styles.interimText}>{interimText}</Text>
              </View>
            ) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
  }
);

export default LiveTranslation;

const styles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    ...Shadow.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.primaryLight,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success, marginLeft: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  participantCount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  participantCountText: { color: Colors.textLight, fontSize: FontSize.xs },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  langFlag: { fontSize: 18 },
  langName: { color: Colors.textWhite, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },

  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ttsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  ttsActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },

  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: Colors.highlight,
    backgroundColor: 'transparent',
  },
  micActive: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  micText: {
    color: Colors.highlight,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
  },

  langDropdown: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  dropdownTitle: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  welcomeBanner: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    gap: 6,
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  welcomeTitle: {
    color: Colors.textWhite,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    textAlign: 'center',
  },
  welcomeHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  langOptionActive: { backgroundColor: Colors.highlightSubtle },
  langOptionFlag: { fontSize: 16 },
  langOptionName: { color: Colors.textWhite, fontSize: FontSize.sm },
  langNativeName: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 1 },
  langSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langSearchInput: {
    flex: 1,
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    padding: 0,
  },
  noResults: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },

  participantsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    borderWidth: 0.5,
    borderColor: Colors.accent,
  },
  chipFlag: { fontSize: 12 },
  chipName: { color: Colors.textSecondary, fontSize: FontSize.xs, maxWidth: 60 },

  feed: {
    maxHeight: 200,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  feedEmpty: { flex: 1, justifyContent: 'center' },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },

  bubble: {
    marginVertical: 3,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
    maxWidth: '85%',
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.highlightSubtle,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryLight,
    borderBottomLeftRadius: 4,
  },
  bubbleInterim: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryLight,
    opacity: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  bubbleSpeaker: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  bubbleTime: { fontSize: 10, color: Colors.textLight },
  bubbleText: { color: Colors.textWhite, fontSize: FontSize.md, lineHeight: 20 },
  bubbleOriginal: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    fontStyle: 'italic',
    marginTop: 3,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: Colors.accent,
  },
  interimDots: { color: Colors.highlight, fontSize: FontSize.lg, fontWeight: FontWeight.bold as any },
  interimText: { color: Colors.textLight, fontSize: FontSize.sm, fontStyle: 'italic' },
});
