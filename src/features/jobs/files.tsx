import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, ConfirmDialog, Dialog, Row, useToast } from '@/components/ui';
import { toUserMessage } from '@/lib/errors';
import type { Attachment } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { deleteAttachment, signedUrl, validateFile, type PickedFile } from './api';

const PREVIEWABLE = ['image/jpeg', 'image/png', 'image/webp'];

function guessMime(name: string, given?: string | null): string {
  if (given && given !== 'application/octet-stream') return given;
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
      pdf: 'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      csv: 'text/csv',
    }[ext ?? ''] ?? given ?? 'application/octet-stream'
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Buttons for adding photos (gallery/camera) and documents. Invalid files are reported, not added. */
export function FilePickerButtons({ onPicked, disabled }: { onPicked: (files: PickedFile[], errors: string[]) => void; disabled?: boolean }) {
  async function pickPhotos(camera: boolean) {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return onPicked([], ['Brak zgody na użycie aparatu. Włącz ją w ustawieniach telefonu.']);
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: !camera, selectionLimit: 10 };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    collect(
      res.assets.map((a, i) => {
        const name = a.fileName ?? `zdjecie-${Date.now()}-${i + 1}.jpg`;
        return { uri: a.uri, name, mimeType: guessMime(name, a.mimeType), size: a.fileSize ?? null, file: (a as any).file };
      }),
    );
  }

  async function pickDocuments() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    collect(res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: guessMime(a.name, a.mimeType), size: a.size ?? null, file: a.file })));
  }

  function collect(files: PickedFile[]) {
    const ok: PickedFile[] = [];
    const errors: string[] = [];
    for (const f of files) {
      const problem = validateFile(f);
      if (problem) errors.push(problem);
      else ok.push(f);
    }
    onPicked(ok, errors);
  }

  return (
    <Row wrap>
      <Button title="Dodaj zdjęcia" icon="images-outline" variant="secondary" compact disabled={disabled} onPress={() => pickPhotos(false)} />
      {Platform.OS !== 'web' ? (
        <Button title="Zrób zdjęcie" icon="camera-outline" variant="secondary" compact disabled={disabled} onPress={() => pickPhotos(true)} />
      ) : null}
      <Button title="Dodaj dokument" icon="document-attach-outline" variant="secondary" compact disabled={disabled} onPress={pickDocuments} />
    </Row>
  );
}

function Thumb({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const previewable = PREVIEWABLE.includes(attachment.mime_type);
  useEffect(() => {
    let alive = true;
    if (previewable) {
      signedUrl(attachment.storage_path)
        .then((u) => alive && setUrl(u))
        .catch(() => alive && setFailed(true));
    }
    return () => {
      alive = false;
    };
  }, [attachment.storage_path, previewable]);

  if (previewable && url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.thumb}
        contentFit="cover"
        accessibilityLabel={attachment.file_name}
        onError={() => setFailed(true)}
      />
    );
  }
  const icon = attachment.mime_type === 'application/pdf' ? 'document-text' : attachment.mime_type.startsWith('image/') ? 'image' : 'document';
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Ionicons name={icon} size={28} color={colors.primary} />
      <AppText variant="small" style={{ textAlign: 'center' }}>
        {attachment.mime_type.startsWith('image/') ? 'Podgląd niedostępny' : (attachment.file_name.split('.').pop() ?? '').toUpperCase()}
      </AppText>
    </View>
  );
}

export function AttachmentGrid({
  attachments,
  canDelete,
  onChanged,
}: {
  attachments: Attachment[];
  canDelete: (a: Attachment) => boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<{ a: Attachment; url: string } | null>(null);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(a: Attachment) {
    try {
      if (PREVIEWABLE.includes(a.mime_type)) {
        setPreview({ a, url: await signedUrl(a.storage_path) });
        return;
      }
      const url = await signedUrl(a.storage_path, a.file_name);
      if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
      else await WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
    } catch (e) {
      toast(toUserMessage(e, 'Nie udało się otworzyć pliku.'), 'error');
    }
  }

  if (attachments.length === 0) return <AppText variant="muted">Brak zdjęć i załączników.</AppText>;

  return (
    <>
      <View style={styles.grid}>
        {attachments.map((a) => (
          <View key={a.id} style={styles.item}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Otwórz ${a.file_name}`} onPress={() => open(a)}>
              <Thumb attachment={a} />
            </Pressable>
            <AppText variant="small" numberOfLines={1}>
              {a.file_name}
            </AppText>
            <Row gap={4}>
              <AppText variant="small" style={{ flex: 1 }}>
                {formatSize(a.size_bytes)}
              </AppText>
              {canDelete(a) ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Usuń ${a.file_name}`} onPress={() => setToDelete(a)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </Row>
          </View>
        ))}
      </View>
      <Dialog
        visible={!!preview}
        title={preview?.a.file_name ?? ''}
        onClose={() => setPreview(null)}
        width={900}
        footer={
          preview ? (
            <Button
              title="Pobierz oryginał"
              variant="secondary"
              icon="download-outline"
              onPress={async () => {
                const url = await signedUrl(preview.a.storage_path, preview.a.file_name);
                if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
                else Linking.openURL(url);
              }}
            />
          ) : null
        }>
        {preview ? <Image source={{ uri: preview.url }} style={{ width: '100%', aspectRatio: 4 / 3 }} contentFit="contain" accessibilityLabel={preview.a.file_name} /> : null}
      </Dialog>
      <ConfirmDialog
        visible={!!toDelete}
        title="Usunąć plik?"
        message={`Plik „${toDelete?.file_name}” zostanie trwale usunięty ze zlecenia.`}
        confirmLabel="Usuń plik"
        destructive
        loading={busy}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          setBusy(true);
          try {
            await deleteAttachment(toDelete);
            toast('Plik usunięty.');
            onChanged();
          } catch (e) {
            toast(toUserMessage(e), 'error');
          } finally {
            setBusy(false);
            setToDelete(null);
          }
        }}
      />
    </>
  );
}

export function PendingFiles({ files, onRemove, progress }: { files: PickedFile[]; onRemove?: (i: number) => void; progress?: Record<number, string> }) {
  if (files.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      {files.map((f, i) => (
        <Row key={`${f.uri}-${i}`} style={styles.pendingRow}>
          <Ionicons name={f.mimeType.startsWith('image/') ? 'image-outline' : 'document-outline'} size={18} color={colors.primary} />
          <AppText style={{ flex: 1 }} numberOfLines={1}>
            {f.name}
          </AppText>
          {f.size ? <AppText variant="small">{formatSize(f.size)}</AppText> : null}
          {progress?.[i] ? <AppText variant="small">{progress[i]}</AppText> : null}
          {onRemove ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Usuń ${f.name} z listy`} onPress={() => onRemove(i)} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

export function FileErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <Banner tone="warning" title="Niektóre pliki nie zostały dodane">
      <View style={{ gap: 2 }}>
        {errors.map((e, i) => (
          <AppText key={i}>{e}</AppText>
        ))}
      </View>
    </Banner>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  item: { width: 140, gap: 4 },
  thumb: { width: 140, height: 105, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, padding: 6 },
  pendingRow: { padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
});
