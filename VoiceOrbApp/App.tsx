import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Switch,
  Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { ReactiveOrb, OrbState, OrbStyle } from './components/ReactiveOrb';
import { useAudioLevel } from './hooks/useAudioLevel';

export default function App() {
  const [state, setState] = useState<OrbState>('idle');
  const [orbStyle, setOrbStyle] = useState<OrbStyle>('default');
  const [manualAudioLevel, setManualAudioLevel] = useState(0.3);
  const [zoom, setZoom] = useState(1.0);
  const [wobble, setWobble] = useState(0.3);
  const [useMic, setUseMic] = useState(false);
  const [fps, setFps] = useState(0);

  const {
    audioLevel: micAudioLevel,
    isRecording,
    hasPermission,
    startRecording,
    stopRecording,
    error,
    debugInfo,
  } = useAudioLevel();

  // FPS counter
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTimeRef.current) / 1000;
      if (elapsed > 0) {
        setFps(Math.round(frameCountRef.current / elapsed));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
    }, 1000);

    const frameCounter = () => {
      frameCountRef.current++;
      requestAnimationFrame(frameCounter);
    };
    const frameId = requestAnimationFrame(frameCounter);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(frameId);
    };
  }, []);

  // Handle mic toggle
  useEffect(() => {
    if (useMic && !isRecording) {
      startRecording();
    } else if (!useMic && isRecording) {
      stopRecording();
    }
  }, [useMic, isRecording, startRecording, stopRecording]);

  const audioLevel = useMic ? micAudioLevel : manualAudioLevel;

  const StateButton = ({ value, label }: { value: OrbState; label: string }) => (
    <TouchableOpacity
      style={[
        styles.stateButton,
        state === value && styles.stateButtonActive,
        state === value && value === 'idle' && styles.stateButtonIdle,
        state === value && value === 'user' && styles.stateButtonUser,
        state === value && value === 'ai' && styles.stateButtonAI,
      ]}
      onPress={() => setState(value)}
    >
      <Text style={[
        styles.stateButtonText,
        state === value && styles.stateButtonTextActive,
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Fullscreen Orb Background */}
      <ReactiveOrb
        audioLevel={audioLevel}
        state={state}
        style={orbStyle}
        zoom={zoom}
        wobble={wobble}
        fullscreen
      />

      {/* Overlay Controls */}
      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Voice AI Orb</Text>
          <Text style={styles.fps}>{fps} FPS</Text>
        </View>

        {/* Spacer to push controls to bottom */}
        <View style={styles.spacer} />

        {/* Bottom Controls */}
        <View style={styles.controls}>
          {/* State Info */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              State: <Text style={styles.infoValue}>{state.toUpperCase()}</Text>
            </Text>
            <Text style={styles.infoText}>
              Audio: <Text style={styles.infoValue}>{(audioLevel * 100).toFixed(0)}%</Text>
            </Text>
            {useMic && (
              <Text style={styles.infoText}>
                Raw: <Text style={styles.infoValue}>{micAudioLevel.toFixed(3)}</Text>
              </Text>
            )}
          </View>

          {/* Style Toggle */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Style</Text>
            <View style={styles.stateButtons}>
              <TouchableOpacity
                style={[
                  styles.stateButton,
                  orbStyle === 'default' && styles.stateButtonActive,
                  orbStyle === 'default' && styles.stateButtonIdle,
                ]}
                onPress={() => setOrbStyle('default')}
              >
                <Text style={[
                  styles.stateButtonText,
                  orbStyle === 'default' && styles.stateButtonTextActive,
                ]}>
                  Default
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.stateButton,
                  orbStyle === 'siri' && styles.stateButtonActive,
                  orbStyle === 'siri' && styles.stateButtonUser,
                ]}
                onPress={() => setOrbStyle('siri')}
              >
                <Text style={[
                  styles.stateButtonText,
                  orbStyle === 'siri' && styles.stateButtonTextActive,
                ]}>
                  Siri
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* State Buttons */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>State</Text>
            <View style={styles.stateButtons}>
              <StateButton value="idle" label="Idle" />
              <StateButton value="user" label="User" />
              <StateButton value="ai" label="AI" />
            </View>
          </View>

          {/* Zoom Slider */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Zoom: {zoom.toFixed(1)}x</Text>
            <Slider
              style={styles.slider}
              minimumValue={0.3}
              maximumValue={3.0}
              value={zoom}
              onValueChange={setZoom}
              minimumTrackTintColor="rgba(255,255,255,0.6)"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#fff"
            />
          </View>

          {/* Wobble Slider */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Wobble: {(wobble * 100).toFixed(0)}%</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1.0}
              value={wobble}
              onValueChange={setWobble}
              minimumTrackTintColor="rgba(255,255,255,0.6)"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#fff"
            />
          </View>

          {/* Audio Level Slider */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Audio Level (Manual)</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              value={manualAudioLevel}
              onValueChange={setManualAudioLevel}
              minimumTrackTintColor="rgba(255,255,255,0.6)"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#fff"
              disabled={useMic}
            />
          </View>

          {/* Mic Toggle */}
          <View style={styles.section}>
            <View style={styles.micToggle}>
              <Text style={styles.sectionTitle}>Use Microphone</Text>
              <Switch
                value={useMic}
                onValueChange={setUseMic}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: 'rgba(255,255,255,0.5)' }}
                thumbColor={useMic ? '#fff' : '#888'}
                disabled={hasPermission === false}
              />
            </View>
            {hasPermission === false && (
              <Text style={styles.errorText}>Microphone permission denied</Text>
            )}
            {error && <Text style={styles.errorText}>{error}</Text>}
            {useMic && isRecording && (
              <Text style={styles.recordingText}>Recording... {debugInfo}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'rgba(255,255,255,0.9)',
  },
  fps: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  spacer: {
    flex: 1,
  },
  controls: {
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    marginHorizontal: 10,
    paddingVertical: 20,
  },
  infoContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 15,
  },
  infoText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  infoValue: {
    color: '#fff',
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stateButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  stateButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stateButtonActive: {
    borderColor: 'rgba(255,255,255,0.5)',
  },
  stateButtonIdle: {
    backgroundColor: 'rgba(128,80,200,0.4)',
  },
  stateButtonUser: {
    backgroundColor: 'rgba(0,200,200,0.4)',
  },
  stateButtonAI: {
    backgroundColor: 'rgba(200,80,150,0.4)',
  },
  stateButtonText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
  },
  stateButtonTextActive: {
    color: '#fff',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  micToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 8,
  },
  recordingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 8,
  },
});
