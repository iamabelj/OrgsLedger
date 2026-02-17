// ============================================================
// OrgsLedger — Live Voice Translation Component
// Real-time speech recognition + multi-language translation
// Uses Web Speech API + Socket.IO + Google Translate
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import { socketClient } from '../../api/socket';
import { api } from '../../api/client';
import { showAlert } from '../../utils/alert';
import { useMeetingStore } from '../../stores/meeting.store';

// ── Language Configuration ────────────────────────────────
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  ar: 'Arabic',
  zh: 'Chinese',
  hi: 'Hindi',
  sw: 'Swahili',
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
  am: 'Amharic',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  tr: 'Turkish',
  id: 'Indonesian',
  ms: 'Malay',
  th: 'Thai',
  vi: 'Vietnamese',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
  tw: 'Twi',
};

const SPEECH_CODES: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', ar: 'ar-SA',
  zh: 'zh-CN', hi: 'hi-IN', sw: 'sw-KE', yo: 'yo-NG', ha: 'ha-NG',
  ig: 'ig-NG', am: 'am-ET', de: 'de-DE', it: 'it-IT', ja: 'ja-JP',
  ko: 'ko-KR', ru: 'ru-RU', tr: 'tr-TR', id: 'id-ID', ms: 'ms-MY',
  th: 'th-TH', vi: 'vi-VN', nl: 'nl-NL', pl: 'pl-PL', uk: 'uk-UA',
  tw: 'ak-GH',
};

export const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', pt: '🇧🇷', ar: '🇸🇦',
  zh: '🇨🇳', hi: '🇮🇳', sw: '🇰🇪', yo: '🇳🇬', ha: '🇳🇬',
  ig: '🇳🇬', am: '🇪🇹', de: '🇩🇪', it: '🇮🇹', ja: '🇯🇵',
  ko: '🇰🇷', ru: '🇷🇺', tr: '🇹🇷', id: '🇮🇩', ms: '🇲🇾',
  th: '🇹🇭', vi: '🇻🇳', nl: '🇳🇱', pl: '🇵🇱', uk: '🇺🇦',
  tw: '🇬🇭',
};

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

  // Zustand store sync — keep centralized state updated
  const storeSetMyLanguage = useMeetingStore((s) => s.setMyLanguage);
  const storeAddTranslation = useMeetingStore((s) => s.addTranslation);
  const storeSetInterimText = useMeetingStore((s) => s.setInterimText);
  const storeSetTranslationParticipants = useMeetingStore((s) => s.setTranslationParticipants);

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const entriesRef = useRef<TranslationEntry[]>([]);

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

    const unsubResult = socketClient.on('translation:result', (data: any) => {
      if (data.meetingId !== meetingId) return;

      const myLang = myLanguageRef.current;
      const translated = data.translations?.[myLang] || data.originalText;

      const entry: TranslationEntry = {
        id: `${data.speakerId}-${data.timestamp}`,
        speakerName: data.speakerName,
        speakerId: data.speakerId,
        originalText: data.originalText,
        translatedText: translated,
        sourceLang: data.sourceLang,
        timestamp: data.timestamp,
      };

      setTranslations((prev) => {
        const next = [...prev, entry].slice(-50); // Keep last 50
        return next;
      });
      setInterimText('');
      // Sync to Zustand store
      storeAddTranslation(entry);
      storeSetInterimText('');

      // Text-to-speech for received translations (not own speech)
      // Voice-to-voice: auto-play TTS when enabled (either per-user or via ttsEnabled flag)
      if (data.speakerId !== userId) {
        const shouldSpeak = speakEnabledRef.current || data.ttsEnabled;
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

    return () => {
      unsubParticipants();
      unsubResult();
      unsubInterim();
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
    socketClient.setTranslationLanguage(meetingId, lang);
    storeSetMyLanguage(lang);
  }, [meetingId]);

  // Initialize: set default language on mount
  useEffect(() => {
    socketClient.setTranslationLanguage(meetingId, myLanguage);
  }, [meetingId]);

  // ── Web Speech Recognition ─────────────────────────────
  const startListening = useCallback(() => {
    if (Platform.OS !== 'web') {
      showAlert('Web Only', 'Voice recognition is available in web browsers. Use the Jitsi video call for native audio.');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showAlert('Not Supported', 'Your browser does not support speech recognition. Try Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_CODES[myLanguage] || 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimText(interim);
        socketClient.sendSpeechForTranslation(meetingId, interim, myLanguageRef.current, false);
      }

      if (final.trim()) {
        setInterimText('');
        socketClient.sendSpeechForTranslation(meetingId, final.trim(), myLanguageRef.current, true);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        showAlert('Microphone Blocked', 'Please allow microphone access in your browser settings.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('Speech recognition error:', event.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch (e) {
          setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [meetingId, myLanguage]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null; // Clear ref first to prevent auto-restart
      try {
        rec.stop();
      } catch (e) {}
    }
    setIsListening(false);
    setInterimText('');
  }, []);

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
  const speak = useCallback((text: string, lang: string) => {
    const langCode = SPEECH_CODES[lang] || 'en-US';
    try {
      if (Platform.OS === 'web') {
        // Cancel any queued speech to avoid overlap
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode;
        utterance.rate = 1.0; // Normal speed for voice-to-voice
        utterance.volume = ttsVolume;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
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

  const selectedFlag = LANG_FLAGS[myLanguage] || '🌐';
  const selectedName = LANGUAGES[myLanguage] || 'English';

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

          {/* ── Language Picker Dropdown ────────────────────── */}
          {showLanguagePicker && (
            <View style={styles.langDropdown}>
              {!hasChosenLanguage ? (
                <>
                  <View style={styles.welcomeBanner}>
                    <Ionicons name="language" size={24} color={Colors.highlight} />
                    <Text style={styles.welcomeTitle}>Choose Your Language</Text>
                    <Text style={styles.welcomeHint}>
                      Select the language you speak. You'll hear others translated into your language in real-time.
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.dropdownTitle}>Change Language</Text>
              )}
              <ScrollView style={{ maxHeight: hasChosenLanguage ? 200 : 300 }} showsVerticalScrollIndicator={false}>
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <TouchableOpacity
                    key={code}
                    style={[styles.langOption, myLanguage === code && styles.langOptionActive]}
                    onPress={() => selectLanguage(code)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.langOptionFlag}>{LANG_FLAGS[code] || '🌐'}</Text>
                    <Text style={[styles.langOptionName, myLanguage === code && { color: Colors.highlight }]}>{name}</Text>
                    {myLanguage === code && <Ionicons name="checkmark" size={16} color={Colors.highlight} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          </>)}

          {/* ── Participant Languages ──────────────────────── */}
          {participants.length > 0 && (
            <View style={styles.participantsBar}>
              {participants.map((p) => (
                <View key={p.userId} style={styles.participantChip}>
                  <Text style={styles.chipFlag}>{LANG_FLAGS[p.language] || '🌐'}</Text>
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
                      {LANG_FLAGS[entry.sourceLang] || '🌐'} {isMe ? 'You' : entry.speakerName}
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
  langOptionName: { color: Colors.textWhite, fontSize: FontSize.sm, flex: 1 },

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
