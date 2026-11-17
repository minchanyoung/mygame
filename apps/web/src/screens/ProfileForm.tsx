import { useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  GENDER_LABELS,
  GENDERS,
  type Gender,
} from '@company-life/shared';

interface Props {
  busy: boolean;
  onSubmit: (displayName: string, gender: Gender) => void;
  onBack: () => void;
}

/** 이름·성별 입력. 최종 검증(금칙어 등)은 서버가 한다 — 여기서는 즉시 피드백용 길이 확인만. */
export function ProfileForm({ busy, onSubmit, onBack }: Props) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const length = Array.from(name.trim()).length;
  const nameOk = length >= DISPLAY_NAME_MIN && length <= DISPLAY_NAME_MAX;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nameOk && gender) onSubmit(name, gender);
  };

  return (
    <form className="screen" onSubmit={submit} noValidate>
      <h2>당신은 누구인가요?</h2>
      <p className="muted">
        이름과 성별은 세 장의 캐릭터 카드에 똑같이 적용됩니다. 채용·연봉·능력 획득에는 영향을 주지 않아요.
      </p>

      <label className="field">
        <span className="field-label">이름</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoComplete="off"
          placeholder="예: 김하늘"
          aria-describedby="name-help"
        />
        <span id="name-help" className={`field-help ${name && !nameOk ? 'field-help-error' : ''}`}>
          {DISPLAY_NAME_MIN}~{DISPLAY_NAME_MAX}자 · 한글/영문/숫자 ({length}자)
        </span>
      </label>

      <fieldset className="field">
        <legend className="field-label">성별</legend>
        <div className="segmented">
          {GENDERS.map((g) => (
            <label key={g} className={`segment ${gender === g ? 'segment-on' : ''}`}>
              <input
                type="radio"
                name="gender"
                value={g}
                checked={gender === g}
                onChange={() => setGender(g)}
              />
              {GENDER_LABELS[g]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="action-bar">
        <button type="button" className="btn" onClick={onBack} disabled={busy}>
          뒤로
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !nameOk || !gender}>
          {busy ? '카드 뽑는 중…' : '카드 3장 뽑기'}
        </button>
      </div>
    </form>
  );
}
