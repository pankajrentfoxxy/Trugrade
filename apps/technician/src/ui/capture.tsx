import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, C, Muted, P } from './kit';

/**
 * The two camera surfaces: scan a code, and take a photograph.
 *
 * Both are deliberately modal and one-shot. A live camera that stays mounted
 * behind a form is the single biggest battery and memory cost in an app like
 * this, and a technician doing forty units has to reach the end of the day on
 * one charge.
 */

export function ScanBox({
  label,
  onScan,
  onCancel,
}: {
  label: string;
  onScan: (value: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  // The scanner fires continuously while a code is in frame. Without this the
  // same label is read thirty times a second and the screen advances twice.
  const handled = useRef(false);

  if (!permission?.granted) {
    return (
      <View style={s.panel}>
        <P>Camera access is needed to scan.</P>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Button title="Cancel" tone="plain" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={s.panel}>
      <Muted>{label}</Muted>
      <CameraView
        style={s.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'datamatrix'] }}
        onBarcodeScanned={(r: BarcodeScanningResult) => {
          if (handled.current) return;
          handled.current = true;
          onScan(r.data);
        }}
      />
      <Button title="Type it instead" tone="plain" onPress={onCancel} />
    </View>
  );
}

export function PhotoBox({
  guidance,
  onCapture,
  onCancel,
}: {
  guidance: string;
  onCapture: (uri: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!permission?.granted) {
    return (
      <View style={s.panel}>
        <P>Camera access is needed to photograph this unit.</P>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Button title="Cancel" tone="plain" onPress={onCancel} />
      </View>
    );
  }

  async function shoot() {
    setBusy(true);
    setError(null);
    try {
      // Captured at full quality; compression happens once, in `preparePhoto`,
      // so the hash that is stored describes the bytes the server receives.
      const shot = await camera.current?.takePictureAsync({ quality: 1, exif: true });
      if (shot?.uri) onCapture(shot.uri);
      else setError('The camera returned nothing. Try again.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.panel}>
      <Banner tone="warn">{guidance}</Banner>
      <CameraView ref={camera} style={s.camera} facing="back" />
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <Button title="Take the photograph" onPress={() => void shoot()} busy={busy} />
      <Button title="Cancel" tone="plain" onPress={onCancel} />
    </View>
  );
}

const s = StyleSheet.create({
  panel: { gap: 10 },
  camera: { height: 380, borderRadius: 10, overflow: 'hidden', backgroundColor: C.ink },
});
