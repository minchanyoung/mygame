import type { GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';

/**
 * 물가 지수 (시작 연도 = 1). 생활비와 사건의 돈 지출·수입은 모두 이 지수를 곱해 적용한다.
 * 콘텐츠의 CASH_DELTA 금액은 '첫해 물가 기준' 금액이다. 연봉은 별도(평가·승진)로 오른다.
 */
export function priceIndex(state: Pick<GameRunState, 'turnIndex'>, content: ContentIndex): number {
  const years = Math.floor(state.turnIndex / 12);
  return Math.pow(1 + content.pack.rules.monthly.livingCostGrowthPermille / 1000, years);
}

/** 물가 반영 금액. 1,000원 단위로 반올림(부호 유지). */
export function inflate(amount: number, index: number): number {
  if (index === 1) return amount;
  return Math.sign(amount) * Math.round((Math.abs(amount) * index) / 1000) * 1000;
}

/** S10 이 판의 난이도 손잡이 */
export function difficultyKnobs(state: Pick<GameRunState, 'difficulty'>, content: ContentIndex) {
  return content.pack.rules.difficulty[state.difficulty];
}

/** S10 사건으로 잃는 자원에 난이도 배율 (얻는 쪽은 그대로). 0이 되지 않게 최소 1은 잃는다 */
export function scaleLoss(amount: number, lossPermille: number): number {
  if (amount >= 0 || lossPermille === 1000) return amount;
  return Math.min(-1, Math.round((amount * lossPermille) / 1000));
}
