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

  // Sync autoTTS prop from parent (e.g., Voice-to-Voice toggle in control bar)
  useEffect(() => { setSpeakEnabled(autoTTS); }, [autoTTS]);

  // ── Audio playback unlock (browser autoplay restriction) ──
  // Browsers require a user gesture before audio can play.
  // Create AudioContext on first click to unlock audio.
  const audioUnlockedRef = useRef(false);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsVolumeRef = useRef(ttsVolume);
  useEffect(() => { ttsVolumeRef.current = ttsVolume; }, [ttsVolume]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        audioUnlockedRef.current = true;
        console.debug('[TTS] Audio context unlocked');
      } catch { /* non-critical */ }
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

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

      // TTS is handled server-side now — audio arrives via 'tts:audio' event

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
        console.warn('[STT] Server audio error:', data.error, data.code);
        // Show visible error to user so they know why transcription isn't working
        showAlert('Transcription Error', data.error || 'Speech recognition failed on the server.');
      }
    });

    const unsubAudioStarted = socketClient.on('audio:started', (data: any) => {
      if (data.meetingId === meetingId) {
        console.debug('[STT] Audio stream started successfully on server');
      }
    });

    return () => {
      unsubParticipants();
      unsubRestored();
      unsubResult();
      unsubInterim();
      unsubAudioError();
      unsubAudioStarted();
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

  // ── Server-Side STT via Audio Segments (OpenAI Whisper) ──
  // Web: MediaRecorder records 4-second segments → complete webm files → server → Whisper
  // Whisper excels at multilingual transcription (50+ languages)
  const SEGMENT_DURATION_MS = 4000; // 4 seconds per segment

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

        // Tell server to start a Whisper STT session
        socketClient.startAudioStream(meetingId, myLanguageRef.current);

        // Rotating recorder: each recorder produces a complete standalone webm file
        // that Whisper can process independently
        let active = true;

        const startSegment = () => {
          if (!active) return;

          const recorder = new MediaRecorder(stream, { mimeType });
          const chunks: Blob[] = [];

          recorder.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = () => {
            // Send complete segment to server for Whisper transcription
            if (chunks.length > 0) {
              const blob = new Blob(chunks, { type: mimeType });
              blob.arrayBuffer().then((buffer: ArrayBuffer) => {
                socketClient.sendAudioSegment(meetingId, buffer);
              }).catch(() => {});
            }
            // Start next segment after a brief pause
            if (active) {
              setTimeout(startSegment, 50);
            }
          };

          recorder.onerror = (e: any) => {
            console.warn('[AUDIO] MediaRecorder error:', e);
            if (active) setTimeout(startSegment, 200);
          };

          recorder.start();

          // Stop this recorder after SEGMENT_DURATION_MS to produce a complete file
          setTimeout(() => {
            if (recorder.state === 'recording') {
              try { recorder.stop(); } catch (_) {}
            }
          }, SEGMENT_DURATION_MS);
        };

        startSegment();
        recognitionRef.current = { stream, stop: () => { active = false; } };
        setIsListening(true);

        console.debug(`[AUDIO] Started segmented audio capture: mimeType=${mimeType}, segment=${SEGMENT_DURATION_MS}ms, meeting=${meetingId}`);
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
      if (Platform.OS === 'web') {
        if (ref.stop) ref.stop(); // Stop the rotation loop
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

  // ── Server-Side TTS Playback (OpenAI TTS via socket) ──
  // Server generates mp3 audio and sends via 'tts:audio' event.
  // Client decodes and plays using Audio element (web) or expo-av (native).
  // Audio queue ensures sequential playback without overlap.

  const playNextTTS = useCallback(() => {
    if (ttsPlayingRef.current || ttsQueueRef.current.length === 0) return;
    ttsPlayingRef.current = true;

    const audioBase64 = ttsQueueRef.current.shift()!;

    if (Platform.OS === 'web') {
      try {
        const raw = atob(audioBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = ttsVolumeRef.current;

        audio.onended = () => {
          console.debug('[TTS] ✓ Audio playback finished');
          URL.revokeObjectURL(url);
          ttsPlayingRef.current = false;
          playNextTTS(); // play next in queue
        };
        audio.onerror = (e) => {
          console.warn('[TTS] Audio element error:', e);
          URL.revokeObjectURL(url);
          ttsPlayingRef.current = false;
          playNextTTS();
        };

        audio.play().then(() => {
          console.debug(`[TTS] ▶ Playing translated audio (${(raw.length / 1024).toFixed(1)}KB, vol=${audio.volume})`);
        }).catch((err) => {
          console.warn('[TTS] Audio play() blocked:', err?.message || err);
          // Chrome autoplay policy may block — try unlocking with AudioContext
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            ctx.resume().then(() => {
              audio.play().catch(() => {
                console.warn('[TTS] Audio play() still blocked after AudioContext resume');
              });
            });
          } catch (_) { /* AudioContext not available */ }
          ttsPlayingRef.current = false;
          playNextTTS();
        });
      } catch (err) {
        console.warn('[TTS] Failed to decode/play audio:', err);
        ttsPlayingRef.current = false;
        playNextTTS();
      }
    } else {
      // Native: play using expo-av (future enhancement)
      // For now, fall back to expo-speech with the text
      ttsPlayingRef.current = false;
      playNextTTS();
    }
  }, []);

  // ── TTS socket event listener ──────────────────────────
  useEffect(() => {
    const unsubTTS = socketClient.on('tts:audio', (data: any) => {
      if (data.meetingId !== meetingId) return;
      if (data.speakerId === userId) return; // Don't play own speech
      if (!speakEnabledRef.current) {
        console.debug('[TTS] Skipping — speakEnabled is false');
        return;
      }

      console.debug(`[TTS] Received audio from ${data.speakerName} (${(data.audio?.length / 1024).toFixed(1)}KB base64)`);
      ttsQueueRef.current.push(data.audio);
      playNextTTS();
    });

    return () => { unsubTTS(); };
  }, [meetingId, userId, playNextTTS]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      ttsQueueRef.current = [];
      ttsPlayingRef.current = false;
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
