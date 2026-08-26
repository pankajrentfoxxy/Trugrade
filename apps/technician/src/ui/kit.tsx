import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/**
 * The whole design system, which is one file because this app has one user in
 * one situation: a technician holding a phone in one hand and a laptop in the
 * other, in a warehouse, often in bad light.
 *
 * That situation dictates the three rules everything below follows. Touch
 * targets are 56 px, not 44, because the other hand is holding a machine.
 * Contrast is high and the palette is small, because the light is fluorescent or
 * absent. And nothing is a subtle state: a blocked unit is red text saying what
 * is wrong, not a grey icon.
 */

export const C = {
  ink: '#101418',
  muted: '#5B6672',
  line: '#DEE3E8',
  bg: '#FFFFFF',
  panel: '#F4F6F8',
  brand: '#12507A',
  ok: '#12703C',
  warn: '#8A5A00',
  bad: '#A81E1E',
  onBrand: '#FFFFFF',
} as const;

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  if (!scroll) return <View style={s.screen}>{children}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.screenContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export const H1 = ({ children }: { children: React.ReactNode }) => <Text style={s.h1}>{children}</Text>;
export const H2 = ({ children }: { children: React.ReactNode }) => <Text style={s.h2}>{children}</Text>;

export const P = ({ children, tone = 'ink' }: { children: React.ReactNode; tone?: keyof typeof C }) => (
  <Text style={[s.p, { color: C[tone] }]}>{children}</Text>
);

export const Muted = ({ children }: { children: React.ReactNode }) => <Text style={s.muted}>{children}</Text>;

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  tone = 'brand',
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  tone?: 'brand' | 'plain' | 'bad';
  disabled?: boolean;
  busy?: boolean;
}) {
  const bg = tone === 'brand' ? C.brand : tone === 'bad' ? C.bad : C.panel;
  const fg = tone === 'plain' ? C.ink : C.onBrand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  autoCapitalize = 'characters',
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  autoCapitalize?: 'none' | 'characters' | 'sentences';
  keyboardType?: 'default' | 'number-pad' | 'email-address' | 'decimal-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, error ? s.inputBad : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
      {error ? <Text style={s.error}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A three-way outcome control.
 *
 * Deliberately three explicit buttons rather than a default plus an override.
 * A default is a value nobody measured, and the whole never-fabricate rule
 * (07 §2) is that a missing value is not a passing value — so the technician has
 * to say PASS, and the absence of an answer stays visible as an absence.
 */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  toneFor,
}: {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  toneFor?: (v: T) => keyof typeof C;
}) {
  return (
    <View style={s.choiceRow}>
      {options.map((opt) => {
        const active = value === opt;
        const tone = toneFor ? C[toneFor(opt)] : C.brand;
        return (
          <Pressable
            key={opt}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt)}
            style={[s.choice, active ? { backgroundColor: tone, borderColor: tone } : null]}
          >
            <Text style={[s.choiceText, active ? { color: C.onBrand } : null]}>{opt.replace(/_/g, ' ')}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, tone = 'muted' }: { label: string; tone?: keyof typeof C }) {
  return (
    <View style={[s.chip, { borderColor: C[tone] }]}>
      <Text style={[s.chipText, { color: C[tone] }]}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.row, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  return (
    <View style={[s.banner, { borderLeftColor: C[tone] }]}>
      <Text style={[s.bannerText, { color: C[tone] }] as StyleProp<TextStyle>}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { padding: 16, gap: 12, paddingBottom: 48 },
  h1: { fontSize: 24, fontWeight: '700', color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 4 },
  p: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13, color: C.muted, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderRadius: 10, padding: 14, gap: 8 },
  button: {
    minHeight: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 17,
    color: C.ink,
    backgroundColor: C.bg,
  },
  inputBad: { borderColor: C.bad },
  error: { fontSize: 13, color: C.bad },
  hint: { fontSize: 13, color: C.muted },
  choiceRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  choice: {
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.line,
  },
  choiceText: { fontSize: 14, fontWeight: '600', color: C.ink },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  banner: {
    borderLeftWidth: 4,
    backgroundColor: C.panel,
    padding: 12,
    borderRadius: 6,
  },
  bannerText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
