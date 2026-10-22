import { makeRng } from "../rng.js";

// Version 1 is a seed-to-name contract. Freeze this corpus, its ordering, the
// model, filters, fallback and RNG namespace together. Future naming changes
// need a new version; saved maps retain the name and version they were given.
export const REGION_NAME_VERSION = 1;

// Hand-authored whole-name examples, rather than adjective/noun fragments or
// borrowed fictional geography. The varied lengths, consonants and endings
// give the character model several sound families instead of one suffix.
const CORPUS_V1 = `
Oravessa Telurion Istrava Velarune Cadrosia Nemerath Osquentra
Ulvaris Esharune Caldrava Veyratha Othenia Tassoren Kelmara
Antheris Iveruna Rasmora Delsavia Nivareth Esparun Lethoria
Ossamira Seraveth Thalune Miradorn Avelora Corvessa Elunara
Vardessa Tamorun Ilvendra Keshalia Ossendral Umerath Zarevia
Arvelis Endrava Sorathen Elarune Kestoria Tembrava Ismaren
Neravoss Valerith Udrania Althera Shavora Peluneth Damoria
Inverath Orevana Seldrune Kareshia Havoren Quenaria Therova
Laevorin Velnara Arassia Novareth Myravel Estorun Sarenva
Ulothia Kelmoria Talvessa Eridava Ormelia Zathoren Venalia
Loraveth Ambruna Casthera Delmoria Rhavena Istrune Olevath
Terenva Sovalith Kaelora Vastrune Hemoria Anadreth Velessa
Elvarun Tavessia Khorena Uldaria Senaveth Asterun
Norelia Cavareth Ilseria Verunth Adrelia Qoraven Esmara
Paruneth Olvaria Merathis Zelmora Idraven Hesalia Toravel
Ulmeria Dovareth Ansoria Keruneth Vessara Imbrelia Orasven
Rethalia Sumerath Taveria Coraven Ashoria Unverath Deloria
Beraveth Lurania Ostelia Emrava Sharunia Azmeria Qeloria
Nysara Maeruna Karsovia Veshara Orinthe Zuvessa Arqelia
Selvaria Naverun Ethoria Dravessa Aluneth Otharva Kernavia
Virmora Oshelia Thevaris Uvaneth Cerenva Ishoria Kalverin
Onarvia Damarith Telvoria Eremora Varoshia Sulneria Avarith
Rovenia Ushaleth Yserava Caldoria Omeren Tarselia Nevoria
Eskalia Varelia Ithenor Olveria Resmara Zalenith Udrevya
Belathum Joraketh Vokarun Keldorin Nalumek Talibesh Mavulon
Kevaros Borathal Dunerak Zimorun Haradek Nulakor Peverin
Goramel Savutek Vardoku Terekun Bakorim Khalemur Zonaruk
Rashavel Novekar Kaletum Valokesh Danurak Mirakesh Jaleron
Sorukem Huvarek Feradun Beruthel Zekarum Lomaver Jarunel
Menovak Duralek Roveshan Kedravan Torumek Savalun Vudareth
Leshakar Tazumel Narovek Vakelun Dorakesh Helumor Banuvek
Kovarim Zuralek Perunam Oshaver Meludak Zanurim Talokar
Adumesh Gilarek Keshuron Beromuk Veshular Tuvarek Omulath
Senakum Orudesh Tarovak Maluker Jovarin Nelurak Zumareth
Ashavel Jhalorin Iskavor Oruketh Vezunal Shelador Ramunek
Thovarek Iduvash Enurkal Thalemor Ovaruk Karuzel Nevukar
Avindel Erelith Sorendel Caladrel Valunel Telerion Osevar
Isenavel Amelion Celandir Nivandel Uselith Everion Daleril
Osilven Helevan Eredil Virelion Meravel Iveldan Thesarel
Neralin Paledrin Elarion Ulendil Olaviel Kerendal Senelir
Anveril Calerun Thiravel Utheril Nelavon Orendil Veleram
Embralin Severil Ildaven Vaelith Ylverin Seradiel Amelvar
Talendil Ceveran Iradiel Evandon Lesavor Orielan Helerim
Nesarel Virandel Anoril Kelevar Ulavien Osenril Deraviel
Arudain Enover Osalden Isenvar Othelien Sireval Elovain
Vaylora Maedrith Caeluron Baelveth Haerulin Naevorin Saelara
Ruskalen Eskovar Dravulen Brastarel Veskarin Uldovek Haskarel
Branovel Trosaven Korudal Skaraven Nelostan Domravel Ostukar
Vestralon Grenovar Kavrodel Belostur Storavel Androvek Melkuran
Trevalek Vaskorin Drunavel Eslovar Bolraken Radovesh Kamrovel
Kresovar Brunalek Vornadel Zestovan Drelakur Valstroth Ondravel
Skeladon Avarosk Ketrolan Yaskorin Brevalek Ramostel Zornavel
Tervoska Glanovel Neskovar Valdoran Ulstarek Brovelin Kerostan
Sarunek Daluvai Namaruvel Kenavari Omalune Taruvana Veskalai
Isuvora Avelaku Nolavari Kasunai Urameli Panavora Yelakum
Arumavo Sevunai Maluvek Tavunara Osarumi Neluvai Kamarelo
Jasuveth Velunaku Umalari Tesavun Lorunai Narukeli Pavamor
Zevulani Harumai Lomariku Vasarun Elumavi Tunarelo Karuvai
Nolumari Osavuli Tamareku Ulanavor Varumeli Esunaku Pelavum
Ravunalo Menakuri Sudaveli Kelumai Jamurelo Navorumi Tulevar
Umaravi Senulaku Varemuli Eshunai Koravumi Melunari Zuravelo
Yndarell Eshavon Valturem Rhelunor Tharovel Ysereth Quenovar
Zeladun Pharelin Tavoreth Udramor Ithovel Quelarin Otharek
Rhavulin Oshalem Veylador Thunarel Ylarune Quoravel Zheralin
Ishadun Khalover Yzareli Queralun Tharevon Aruzhel Ovekar
Yndavora Rhaemul Orvashan Teladum Phelovar Zhelurin Vayranel
`.toLowerCase().trim().split(/\s+/);

const knownNames = new Set(CORPUS_V1);
const models = [null, new Map(), new Map(), new Map()];
for (const name of CORPUS_V1) {
  const padded = `^^^${name}$`;
  for (let index = 3; index < padded.length; index++) {
    for (let order = 1; order <= 3; order++) {
      const key = padded.slice(index - order, index);
      const transitions = models[order].get(key) ?? new Set();
      transitions.add(padded[index]);
      models[order].set(key, transitions);
    }
  }
}
// A transition is represented once even if many examples share it. Otherwise
// common endings such as -aria overwhelm the less frequent sound families.
for (const model of models.slice(1)) {
  for (const [key, transitions] of model) model.set(key, [...transitions]);
}

function candidate(rng) {
  let text = "^^^";
  for (let index = 0; index < 12; index++) {
    let order = rng() < 0.8 ? 2 : 3;
    while (!models[order].has(text.slice(-order))) order--;
    const choices = models[order].get(text.slice(-order));
    const next = choices[Math.floor(rng() * choices.length)];
    if (next === "$") return text.slice(3);
    text += next;
  }
  return "";
}

function isPronounceable(name) {
  const vowelGroups = name.match(/[aeiouy]+/g) ?? [];
  return name.length >= 7 && name.length <= 11
    && vowelGroups.length >= 3 && vowelGroups.length <= 4
    && !knownNames.has(name)
    && !/[^aeiouy]{4}|[aeiouy]{3}|(.)\1\1|(.{2,3})\2/.test(name)
    && !/(.{3}).*\1/.test(name);
}

// A bounded safety net, independent of model success. These are complete,
// pronounceable names, not fragments to assemble into a formulaic compound.
const FALLBACK_V1 = [
  "Avorulen", "Theravuni", "Kesumarel", "Oraluveth",
  "Naloviren", "Uveralis", "Zerumavel", "Ishaloren",
  "Talumerin", "Oseravun", "Velumarek", "Amorulen",
  "Serevakon", "Iralumeth", "Kelunavor", "Pheluravi",
];

// Kept separate so bounded behavior can be tested with an adversarial stream.
// Production callers use generateRegionName, never the terrain's RNG stream.
export function generateRegionNameFromRng(rng) {
  for (let attempt = 0; attempt < 96; attempt++) {
    const name = candidate(rng);
    if (isPronounceable(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return FALLBACK_V1[Math.floor(rng() * FALLBACK_V1.length)];
}

export function generateRegionName(seed) {
  return generateRegionNameFromRng(makeRng(`continent-name:v1:${seed}`));
}
