import { PROFILE_IMAGE_MAX_LENGTH, PROFILE_IMAGE_MAX_PX, PROFILE_IMAGE_TARGET_LENGTH } from './constants';

/* テキストをファイルとしてダウンロードさせる */
export function downloadTextFile(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* プロフィール画像を読み込み、canvas で最大256×256に縮小して data URL 化する。
   PNGで収まればそのまま、大きければ JPEG の品質を段階的に落として再圧縮する。
   それでも上限を超える場合は error を返す。 */
export function processProfileImage(
  file: File,
): Promise<{ dataUrl: string | null; error: string | null }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, PROFILE_IMAGE_MAX_PX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ dataUrl: null, error: '画像を処理できませんでした。別の画像を選んでください。' });
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let dataUrl = '';
          if (file.type === 'image/png') {
            dataUrl = canvas.toDataURL('image/png');
          }
          if (dataUrl === '' || dataUrl.length > PROFILE_IMAGE_TARGET_LENGTH) {
            const qualities = [0.85, 0.7, 0.55, 0.4, 0.3];
            for (let i = 0; i < qualities.length; i++) {
              dataUrl = canvas.toDataURL('image/jpeg', qualities[i]);
              if (dataUrl.length <= PROFILE_IMAGE_TARGET_LENGTH) break;
            }
          }
          if (dataUrl.length > PROFILE_IMAGE_MAX_LENGTH) {
            resolve({
              dataUrl: null,
              error: '画像が大きすぎるため保存できませんでした。もう少し小さい画像を選んでください。',
            });
            return;
          }
          resolve({ dataUrl, error: null });
        } catch {
          resolve({ dataUrl: null, error: '画像を処理できませんでした。別の画像を選んでください。' });
        }
      };
      img.onerror = () => {
        resolve({ dataUrl: null, error: '画像を読み込めませんでした。別の画像を選んでください。' });
      };
      img.src = String(reader.result);
    };
    reader.onerror = () => {
      resolve({ dataUrl: null, error: '画像を読み込めませんでした。' });
    };
    reader.readAsDataURL(file);
  });
}

/* ファイルをテキストとして読む（サイズ上限は呼び出し側で事前にチェックする） */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read error'));
    reader.readAsText(file);
  });
}
