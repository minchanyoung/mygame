import { useState, type FormEvent } from 'react';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  GENDER_LABELS,
  GENDERS,
  type Difficulty,
  type Gender,
} from '@company-life/shared';

/** 난이도 한 줄 설명 (정확한 수치는 숨긴다) */
const DIFFICULTY_HELP: Record<Difficulty, string> = {
  EASY: '처음이라면. 일이 조금 더 잘 풀리고 덜 지친다.',
  NORMAL: '기본. 신중하게 하면 대부분 50세를 넘긴다.',
  REAL: '현실은 냉정하다. 신중해도 절반쯤은 50세 전에 회사를 떠난다.',
};

interface Props {
  busy: boolean;
  onSubmit: (displayName: string, gender: Gender, difficulty: Difficulty, daily: boolean) => void;
  onBack: () => void;
}

/** 이름·성별 입력. 최종 검증(금칙어 등)은 서버가 한다 — 여기서는 즉시 피드백용 길이 확인만. */
export function ProfileForm({ busy, onSubmit, onBack }: Props) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('NORMAL');
  const [daily, setDaily] = useState(false);
  const length = Array.from(name.trim()).length;
  const nameOk = length >= DISPLAY_NAME_MIN && length <= DISPLAY_NAME_MAX;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nameOk && gender) onSubmit(name, gender, daily ? 'NORMAL' : difficulty, daily);
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

      <label className={`card daily-toggle ${daily ? 'daily-on' : ''}`}>
        <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
        <span className="col">
          <strong className="small">📅 오늘의 출근으로 하기</strong>
          <span className="tiny muted">
            오늘은 모두 같은 카드·같은 동료로 시작해요. 난이도는 보통, 하루 첫 판의 결과로 순위를 겨뤄요.
          </span>
        </span>
      </label>

      <fieldset className="field" disabled={daily}>
        <legend className="field-label">난이도</legend>
        <div className="segmented segmented-3">
          {DIFFICULTIES.map((d) => (
            <label key={d} className={`segment ${difficulty === d ? 'segment-on' : ''}`}>
              <input
                type="radio"
                name="difficulty"
                value={d}
                checked={difficulty === d}
                onChange={() => setDifficulty(d)}
              />
              {DIFFICULTY_LABELS[d]}
            </label>
          ))}
        </div>
        <span className="field-help">{DIFFICULTY_HELP[difficulty]} 시작한 뒤에는 바꿀 수 없어요.</span>
      </fieldset>

      <div className="action-bar">
        <button type="button" className="btn" onClick={onBack} disabled={busy}>
          뒤로
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !nameOk || !gender}>
          {busy ? '진행 중…' : '진행하기'}
        </button>
      </div>
    </form>
  );
}
