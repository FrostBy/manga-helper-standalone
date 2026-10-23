// Run: pnpm test
// Cases are real links from the 2026-10-23 audit of 134 linked titles.
import assert from 'node:assert/strict';
import { scoreCandidate, sameAuthor, authorsAgree, idsInLinks, yearIn, REJECT_AT, type TitleProfile } from './matchScore.ts';

const profile = (p: Partial<TitleProfile>): TitleProfile => ({ authors: [], ids: {}, ...p });
const rejected = (page: TitleProfile, candidate: TitleProfile) => scoreCandidate(page, candidate) <= REJECT_AT;

// Romanizations and word order of one author.
assert.ok(sameAuthor('Hongsil Jipery', 'Hong Sil Jiperi'));
assert.ok(sameAuthor('Cheongdam', 'Cheong Dam'));
assert.ok(sameAuthor('Shigeno Shuuichi', 'Shuuichi Shigeno'));
assert.ok(sameAuthor('Wei Ma', 'Ma Wei'));
assert.ok(sameAuthor('Lee Sanghyuk', 'Sang-Hyeok Lee'));
assert.ok(sameAuthor('Сигэно Сюити', 'Сигено Сюити'));
// Short names and shared surnames must not tie strangers.
assert.ok(!sameAuthor('Banana', 'Mon'));
assert.ok(!sameAuthor('Anngato', 'Nokta'));
assert.ok(!sameAuthor('Jung Ryul Kim', 'Roah Kim'));
assert.ok(!sameAuthor('Kazuki Takahashi', 'Kazuki Nakashima'));
// Latin romanizations may differ while the Cyrillic names agree.
assert.equal(authorsAgree(['Pak Senal', 'Пак Сэналь'], ['Sae-Nal Park', 'Пак Сэналь']), true);
// A studio signs many works; scripts that differ can't be compared.
assert.equal(authorsAgree(['Redice Studio'], ['Studio Inus']), undefined);
assert.equal(authorsAgree(['Сигэно Сюити'], ['Shuuichi Shigeno']), undefined);

const wolfManhua = profile({ year: 2020, authors: ['Wei Ma'], ids: { al: '123409' }, series: [38983] });
const ourouden = profile({ year: 1989, authors: ['Buronson', 'Kentarou Miura'], ids: { mal: '10867' }, series: [35918] });
assert.ok(rejected(wolfManhua, ourouden));
// Without any ID the year and the authors still tell them apart.
assert.ok(rejected(profile({ year: 2020, authors: ['Ma Wei'] }), profile({ year: 1989, authors: ['Buronson', 'Kentarou Miura'] })));

// Curses!!! (2020) vs «Проклятие» (2003), Half-Blood (2025) vs blood_type_prince (2011): only the year.
assert.ok(rejected(profile({ year: 2020 }), profile({ year: 2003 })));
assert.ok(rejected(profile({ year: 2025, authors: ['Bangyo', 'Jung Ryul Kim'] }), profile({ year: 2011, authors: ['Koma', 'Цукигасэ Юрино'] })));
assert.ok(rejected(profile({ year: 2021, authors: ['Peke'] }), profile({ year: 2016, authors: ['Hiromitsu Takeda'] })));

// Black Haze: same author, the edition of the right year wins over the remake.
const blackHaze2012 = profile({ year: 2012, authors: ['Yong Yong'] });
const old = scoreCandidate(blackHaze2012, profile({ year: 2012, authors: ['YongYong'] }));
const remake = scoreCandidate(blackHaze2012, profile({ year: 2025, authors: ['Yong Yong'] }));
assert.ok(old > remake && remake > REJECT_AT);
// Senkuro's old Black Haze carries no year or authors at all: it still beats the remake.
assert.ok(scoreCandidate(blackHaze2012, profile({})) > remake);

// An alternative edition is related, which outweighs a few years off.
assert.ok(!rejected(profile({ year: 2020, series: [833] }), profile({ year: 2017, series: [30428], related: [833] })));
// MangaBaka marks the Black Haze remake as an alternative too: the original still wins by far.
const haze2012 = profile({ year: 2012, authors: ['Yong Yong'], series: [17758], related: [1543] });
assert.ok(
  scoreCandidate(haze2012, profile({ year: 2012, authors: ['Yong Yong'], series: [17758] })) >
    scoreCandidate(haze2012, profile({ year: 2025, authors: ['Yong Yong'], series: [1543], related: [17758] })) + 5
);
// Adaptation year or translation year: a few years off with a pen name is kept.
assert.ok(!rejected(profile({ year: 2020 }), profile({ year: 2017 })));
assert.ok(!rejected(profile({ year: 2022, authors: ['Yu-Wol', 'Nunnya'] }), profile({ year: 2024, authors: ['MedullaMind'] })));
// Same raw ID without MangaBaka.
assert.ok(scoreCandidate(profile({ ids: { mu: 'x2yc82s' } }), profile({ ids: { mu: 'x2yc82s' } })) >= 5);
// A differing raw ID without MangaBaka may be another edition's entry: no evidence.
assert.equal(scoreCandidate(profile({ ids: { mu: '95gz3bp' } }), profile({ ids: { mu: 'x2yc82s' } })), 0);
// No evidence: linked by name as before.
assert.equal(scoreCandidate(profile({}), profile({ year: 2019, authors: ['Someone'] })), 0);

assert.deepEqual(idsInLinks('<a href="https://www.mangaupdates.com/series/95gz3bp/mf-ghost">MU</a> https://mangabaka.org/1687'), {
  mu: '95gz3bp',
  mal: undefined,
  al: undefined,
  baka: '1687',
});
// Two MangaUpdates links (a related title) can't tell which one is this title.
assert.equal(idsInLinks('mangaupdates.com/series/aaa1 mangaupdates.com/series/bbb2').mu, undefined);
assert.equal(yearIn('Манга 2017 Продолжается'), 2017);
assert.equal(yearIn('2017 г.'), 2017);
assert.equal(yearIn(undefined), undefined);

console.log('matchScore: ok');
