/**
 * Compact built-in emoji dataset (authored for FunPro) with English and Russian keywords, used by
 * the emoji picker on funpay.com. Pure data + search; no DOM.
 *
 * Line format: `<emoji>[~] <english keywords> | <russian keywords>`. The first keyword of each
 * language is the display name (`_` joins words). A trailing `~` means "append the emoji variation
 * selector at runtime": the source deliberately contains no invisible code points.
 */

export type EmojiCategory =
  'smileys' | 'gestures' | 'hearts' | 'nature' | 'food' | 'activities' | 'travel' | 'objects' | 'symbols';

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  'smileys',
  'gestures',
  'hearts',
  'nature',
  'food',
  'activities',
  'travel',
  'objects',
  'symbols',
];

export interface Emoji {
  char: string;
  category: EmojiCategory;
  en: string[];
  ru: string[];
}

const RAW: Record<EmojiCategory, string> = {
  smileys: `
😀 grinning smile happy | улыбка радость счастье
😃 smiley smile happy joy | улыбка радость
😄 smile laugh happy | улыбка смех радость
😁 beaming grin smile | ухмылка улыбка зубы
😆 laughing lol haha | смех хаха ржу
😅 sweat_smile phew relief | улыбка пот фух
🤣 rofl laughing floor | ржу катаюсь смех
😂 joy tears laughing lol | слезы смех ржу
🙂 slight_smile ok fine | улыбка норм
🙃 upside_down silly irony | перевернутый ирония
😉 wink flirt | подмигивание подмигнуть
😊 blush smile happy | улыбка румянец довольный
😇 innocent angel halo | ангел невинный
🥰 adore love hearts | обожаю любовь сердечки
😍 heart_eyes love crush | влюблен любовь глаза
🤩 star_struck wow amazing | восторг вау звезды
😘 kiss blow love | поцелуй чмок
😗 kissing | поцелуй
😚 kissing_closed_eyes | поцелуй
😙 kissing_smiling | поцелуй
😋 yum tasty delicious | вкусно ням
😛 tongue playful | язык дразнить
😜 winking_tongue crazy joke | шутка язык подмигивание
🤪 zany crazy goofy | безумный псих
😝 squinting_tongue | язык дразнить
🤑 money_mouth rich dollar | деньги богатый
🤗 hug hugging thanks | обнимаю объятия спасибо
🤭 hand_over_mouth oops giggle | упс хихи
🤫 shush quiet secret | тихо тсс секрет
🤔 thinking hmm wonder | думаю хмм размышление
🤐 zipper_mouth silence | молчу рот_на_замке
🤨 raised_eyebrow doubt suspicious | сомнение подозрение бровь
😐 neutral meh | нейтрально равнодушие
😑 expressionless blank | безразличие
😶 no_mouth speechless | без_слов молчание
😏 smirk sly | ухмылка хитрый
😒 unamused bored | недовольный скука
🙄 eye_roll whatever | закатываю_глаза ну_да
😬 grimace awkward | неловко гримаса
😌 relieved calm peace | облегчение спокойствие
😔 pensive sad | грусть задумчивость
😪 sleepy tired | сонный устал
🤤 drool want | слюни хочу
😴 sleeping zzz | сплю сон
😷 mask sick | маска болею
🤒 thermometer ill fever | болею температура
🤕 bandage hurt | травма больно
🤢 nauseated sick gross | тошнит фу
🤮 vomit disgust | рвота отвращение
🥵 hot heat sweat | жарко жара
🥶 cold freezing | холодно мороз
🥴 woozy drunk dizzy | пьяный головокружение
😵 dizzy knocked_out | головокружение
🤯 mind_blown shock explode | взрыв_мозга шок
🤠 cowboy yeehaw | ковбой
🥳 party celebrate birthday | праздник вечеринка ура
😎 cool sunglasses | круто очки крутой
🤓 nerd geek | ботаник умник
🧐 monocle inspect | монокль изучаю
😕 confused unsure | растерян непонятно
😟 worried concern | беспокойство тревога
🙁 frown sad | грустно
😮 open_mouth surprise oh | удивление ох
😯 hushed surprised | удивлен
😲 astonished shocked | изумление шок
😳 flushed embarrassed | смущение стыд
🥺 pleading please puppy_eyes | пожалуйста умоляю
😦 frowning_open | огорчение
😧 anguished | страдание
😨 fearful scared | страх испуг
😰 anxious sweat | тревога волнение
😥 disappointed_relieved | разочарование
😢 crying sad tear | плачу грусть слеза
😭 sobbing cry | рыдаю плачу
😱 scream fear omg | крик ужас
😖 confounded | смятение
😣 persevering struggle | терплю
😞 disappointed sad | разочарован
😓 downcast_sweat | расстроен
😩 weary tired | устал измучен
😫 tired_face exhausted | изнеможение
🥱 yawn bored | зеваю скука
😤 triumph huff | фыркаю раздражение
😡 pouting angry rage | злой ярость
😠 angry mad | злость сердитый
🤬 cursing swearing | ругань мат
😈 smiling_devil evil | дьявол злодей
👿 angry_devil imp | черт демон
💀 skull dead | череп умер
💩 poop | какашка
🤡 clown | клоун
👻 ghost boo | привидение призрак
👽 alien ufo | инопланетянин нло
🤖 robot bot | робот бот
😺 grinning_cat | кот улыбка
😹 cat_joy | кот смех
😻 cat_heart_eyes | кот любовь
😼 cat_smirk | кот ухмылка
🙀 weary_cat | кот шок
😿 crying_cat | кот плачет
🙈 see_no_evil monkey | обезьянка не_вижу
🙉 hear_no_evil monkey | обезьянка не_слышу
🙊 speak_no_evil monkey | обезьянка молчу
`,
  gestures: `
👋 wave hello hi bye | привет пока машу
🤚 raised_back_hand | рука
✋ raised_hand stop high_five | рука стоп
🖖 vulcan salute | вулкан приветствие
👌 ok_hand perfect | окей отлично
🤏 pinching small little | чуть_чуть немного
✌~ victory peace | мир победа
🤞 fingers_crossed luck hope | удачи надеюсь
🤟 love_you_gesture | люблю
🤘 rock horns metal | рок коза
🤙 call_me shaka | позвони
👈 point_left | налево указатель
👉 point_right | направо указатель
👆 point_up | вверх указатель
👇 point_down | вниз указатель
👍 thumbs_up like ok yes good | лайк класс да хорошо палец_вверх
👎 thumbs_down dislike no bad | дизлайк плохо нет
✊ raised_fist power | кулак сила
👊 punch fist_bump | кулак удар
🤛 left_fist | кулак
🤜 right_fist | кулак
👏 clap applause bravo | аплодисменты браво хлопаю
🙌 raising_hands hooray | ура руки
👐 open_hands | руки
🤲 palms_up please | ладони прошу
🤝 handshake deal agreement | рукопожатие сделка договорились
🙏 pray thanks please | спасибо пожалуйста молюсь
💅 nail_polish | маникюр
💪 muscle strong | сила мышцы сильный
🧠 brain smart | мозг умный
👀 eyes look see | глаза смотрю
👅 tongue | язык
👄 mouth lips | губы рот
👶 baby | малыш ребенок
🧒 child kid | ребенок
👦 boy | мальчик
👧 girl | девочка
🧑 person adult | человек взрослый
👨 man | мужчина
👩 woman | женщина
🧓 older_person | пожилой
👴 old_man grandpa | дедушка
👵 old_woman grandma | бабушка
🙋 raising_hand question | вопрос поднимаю_руку
🙆 ok_gesture yes | согласен
🙅 no_gesture refuse | нельзя нет
🤷 shrug dunno | не_знаю пожимаю_плечами
🤦 facepalm | фейспалм рукалицо
🙇 bow sorry | поклон извините
💁 tipping_hand info | информация
🕺 dancing man | танцую
💃 dancer woman dance | танец танцую
👑 crown king queen | корона король
🎩 top_hat | цилиндр шляпа
`,
  hearts: `
❤~ red_heart love | сердце любовь
🧡 orange_heart | оранжевое_сердце
💛 yellow_heart | желтое_сердце
💚 green_heart | зеленое_сердце
💙 blue_heart | синее_сердце
💜 purple_heart | фиолетовое_сердце
🖤 black_heart | черное_сердце
🤍 white_heart | белое_сердце
🤎 brown_heart | коричневое_сердце
💔 broken_heart | разбитое_сердце
💕 two_hearts love | сердечки любовь
💞 revolving_hearts | сердечки
💓 beating_heart | бьющееся_сердце
💗 growing_heart | сердце
💖 sparkling_heart | сверкающее_сердце
💘 heart_arrow cupid | купидон сердце
💝 heart_gift ribbon | сердце подарок
💟 heart_decoration | сердце
💌 love_letter | любовное_письмо
💋 kiss_mark lips | поцелуй
`,
  nature: `
🐶 dog puppy | собака щенок
🐱 cat kitty | кот кошка котик
🐭 mouse | мышь
🐹 hamster | хомяк
🐰 rabbit bunny | кролик зайка
🦊 fox | лиса
🐻 bear | медведь
🐼 panda | панда
🐨 koala | коала
🐯 tiger | тигр
🦁 lion | лев
🐮 cow | корова
🐷 pig | свинья
🐸 frog | лягушка
🐵 monkey | обезьяна
🐔 chicken | курица
🐧 penguin | пингвин
🐦 bird | птица
🐤 chick | цыпленок
🦆 duck | утка
🦅 eagle | орел
🦉 owl | сова
🐺 wolf | волк
🐴 horse | лошадь
🦄 unicorn | единорог
🐝 bee | пчела
🐛 bug | гусеница жук
🦋 butterfly | бабочка
🐌 snail slow | улитка медленно
🐞 ladybug | божья_коровка
🐢 turtle slow | черепаха
🐍 snake | змея
🦖 dinosaur trex | динозавр
🐙 octopus | осьминог
🦀 crab | краб
🐠 fish tropical | рыба
🐬 dolphin | дельфин
🐳 whale | кит
🦈 shark | акула
🐊 crocodile | крокодил
🐘 elephant | слон
🦒 giraffe | жираф
🐪 camel | верблюд
🐾 paw_prints | лапки следы
🌵 cactus | кактус
🎄 christmas_tree new_year | елка новый_год
🌲 evergreen tree | ель дерево
🌳 tree | дерево
🌴 palm_tree | пальма
🌱 seedling sprout | росток
🌿 herb leaf | трава лист
🍀 four_leaf_clover luck | клевер удача
🍁 maple_leaf autumn | клен осень лист
🍂 fallen_leaves autumn | листопад осень
🍃 leaves wind | листья ветер
🌷 tulip flower | тюльпан цветок
🌹 rose flower | роза цветок
🥀 wilted_flower | увядший_цветок
🌺 hibiscus flower | цветок
🌸 cherry_blossom flower | сакура цветок
🌼 blossom flower | цветок
🌻 sunflower | подсолнух
🌞 sun_face sunny | солнце солнышко
🌝 full_moon_face | луна
🌙 crescent_moon night | луна ночь
🌍 earth globe world | земля мир глобус
🌈 rainbow | радуга
☀~ sun sunny weather | солнце погода
⛅ cloud_sun | облачно
❄~ snowflake winter cold | снежинка зима холод
⛄ snowman winter | снеговик зима
⭐ star | звезда
🌟 glowing_star | звезда сияние
✨ sparkles shine magic | блестки сияние магия
⚡ lightning fast energy | молния быстро энергия
🔥 fire hot lit | огонь горячо топ
💧 droplet water | капля вода
🌊 wave ocean | волна океан
`,
  food: `
🍏 green_apple | яблоко
🍎 red_apple | яблоко
🍐 pear | груша
🍊 tangerine orange | мандарин апельсин
🍋 lemon | лимон
🍌 banana | банан
🍉 watermelon | арбуз
🍇 grapes | виноград
🍓 strawberry | клубника
🍒 cherries | вишня черешня
🍑 peach | персик
🥭 mango | манго
🍍 pineapple | ананас
🥥 coconut | кокос
🥝 kiwi | киви
🍅 tomato | помидор
🥑 avocado | авокадо
🥦 broccoli | брокколи
🥕 carrot | морковь
🌽 corn | кукуруза
🥔 potato | картошка
🍞 bread | хлеб
🥐 croissant | круассан
🧀 cheese | сыр
🥚 egg | яйцо
🍳 cooking fried_egg | яичница готовлю
🥞 pancakes | блины
🥓 bacon | бекон
🍗 chicken_leg | курица ножка
🍖 meat | мясо
🌭 hot_dog | хот_дог
🍔 burger hamburger | бургер
🍟 fries | картошка_фри
🍕 pizza | пицца
🥪 sandwich | бутерброд сэндвич
🌮 taco | тако
🌯 burrito | буррито шаурма
🥗 salad | салат
🍝 spaghetti pasta | спагетти паста
🍜 noodles ramen | лапша рамен
🍣 sushi | суши
🍱 bento | бенто
🍤 shrimp | креветка
🍙 rice_ball | онигири
🍚 rice | рис
🍦 ice_cream | мороженое
🍩 donut | пончик
🍪 cookie | печенье
🎂 birthday_cake | торт день_рождения
🍰 cake | торт пирожное
🧁 cupcake | капкейк
🍫 chocolate | шоколад
🍬 candy | конфета
🍭 lollipop | леденец
🍯 honey | мед
☕ coffee tea hot | кофе чай
🍵 tea | чай
🧃 juice | сок
🥤 soda drink | напиток газировка
🍺 beer | пиво
🍻 cheers beers | пиво тост
🥂 champagne_glasses toast | шампанское тост
🍷 wine | вино
🥃 whisky | виски
🍸 cocktail | коктейль
🍹 tropical_drink | коктейль
🍾 champagne celebrate | шампанское праздник
🧊 ice | лед
`,
  activities: `
🎮 video_game gaming gamepad | игра геймпад игры
🕹~ joystick arcade | джойстик аркада
👾 space_invader game retro | игра пришелец ретро
🎲 dice game random | кубик кости игра
🎯 target goal bullseye | цель мишень точно
🧩 puzzle | пазл головоломка
♟~ chess pawn | шахматы пешка
🃏 joker card | джокер карта
🎰 slot_machine casino | слот казино
🎳 bowling | боулинг
⚽ soccer football | футбол мяч
🏀 basketball | баскетбол
🏈 american_football | регби мяч
⚾ baseball | бейсбол
🎾 tennis | теннис
🏐 volleyball | волейбол
🏉 rugby | регби
🎱 billiards pool | бильярд
🏓 ping_pong | пинг_понг
🏸 badminton | бадминтон
🥊 boxing | бокс
🥋 martial_arts | единоборства кимоно
⛳ golf | гольф
🎣 fishing | рыбалка
🏆 trophy win champion | кубок победа чемпион
🥇 gold_medal first | золото первое_место
🥈 silver_medal second | серебро второе_место
🥉 bronze_medal third | бронза третье_место
🏅 medal | медаль
🎖~ military_medal | орден медаль
🎫 ticket | билет
🎪 circus | цирк
🎭 theater | театр
🎨 art palette | искусство палитра
🎬 movie clapper | кино фильм
🎤 microphone sing | микрофон пою
🎧 headphones music | наушники музыка
🎼 musical_score | ноты
🎹 piano | пианино
🥁 drum | барабан
🎷 saxophone | саксофон
🎺 trumpet | труба
🎸 guitar | гитара
🎻 violin | скрипка
🎉 party_popper tada congrats | ура праздник поздравляю
🎊 confetti celebrate | конфетти праздник
🎈 balloon | шарик
🎁 gift present bonus | подарок бонус
🎀 ribbon bow | бант лента
🎆 fireworks | фейерверк салют
🎇 sparkler | бенгальский_огонь
🧨 firecracker | петарда
🏹 bow_arrow archer | лук стрелы
⚔~ crossed_swords battle pvp | мечи битва бой
🛡~ shield defense | щит защита
💣 bomb | бомба
`,
  travel: `
🚀 rocket fast launch boost | ракета быстро буст
✈~ airplane flight | самолет полет
🚗 car | машина авто
🚕 taxi | такси
🚌 bus | автобус
🚓 police_car | полиция
🚑 ambulance | скорая
🚒 fire_engine | пожарная
🚲 bicycle bike | велосипед
🛴 scooter | самокат
🚂 train | поезд
🚢 ship | корабль
⛵ sailboat | парусник
🚁 helicopter | вертолет
🏠 house home | дом
🏡 house_garden | дом сад
🏢 office building | офис здание
🏰 castle | замок
🗽 statue_of_liberty | статуя_свободы
🗼 tower | башня
🌋 volcano | вулкан
🗻 mount_fuji mountain | гора
🌃 night_city | ночной_город
🌆 cityscape_dusk | город вечер
🌇 sunset | закат
🌉 bridge_night | мост
🎡 ferris_wheel | колесо_обозрения
🎢 roller_coaster | американские_горки
⛺ tent camping | палатка поход
`,
  objects: `
📦 package box delivery parcel | посылка коробка доставка
📫 mailbox | почтовый_ящик
📩 envelope_arrow incoming | письмо входящее
📨 incoming_envelope | письмо
📧 email | почта имейл
✉~ envelope letter | конверт письмо
📝 memo note write | заметка записка пишу
📌 pushpin pin | кнопка закрепить
📍 round_pushpin location | метка место
📎 paperclip attach | скрепка вложение
✂~ scissors cut | ножницы
🔑 key | ключ
🔒 locked secure | замок закрыто безопасно
🔓 unlocked open | открыто замок
🔐 locked_key | замок ключ
💰 money_bag | деньги мешок
💵 dollar banknote | доллары купюра
💶 euro banknote | евро купюра
💸 money_wings spend | деньги трата
💳 credit_card payment | карта оплата
💎 gem diamond | алмаз бриллиант кристалл
🛒 shopping_cart buy | корзина покупка
🧾 receipt | чек
📈 chart_up growth | рост график
📉 chart_down decline | падение график
📊 bar_chart stats | статистика график
📋 clipboard list | список буфер
📅 calendar date | календарь дата
📆 tear_off_calendar | календарь
⏰ alarm_clock time | будильник время
⏳ hourglass waiting | песочные_часы ожидание жду
⌛ hourglass_done time | время песочные_часы
🕐 one_oclock time | время час
📱 phone mobile | телефон смартфон
💻 laptop computer | ноутбук компьютер
🖥~ desktop_computer pc | компьютер пк
⌨~ keyboard | клавиатура
💾 floppy save | дискета сохранить
💿 cd disc | диск
📷 camera photo | фотоаппарат фото
📸 camera_flash screenshot | фото скриншот
🎥 movie_camera video | видео камера
📺 tv | телевизор
📻 radio | радио
🔋 battery | батарея
🔌 plug | вилка розетка
💡 bulb idea | лампочка идея
🔦 flashlight | фонарик
🔧 wrench fix | гаечный_ключ ремонт
🔨 hammer | молоток
⚙~ gear settings | шестеренка настройки
🧲 magnet | магнит
🧪 test_tube | пробирка
🔬 microscope | микроскоп
🔭 telescope | телескоп
📡 satellite antenna | антенна спутник
💊 pill | таблетка
🚪 door | дверь
🧸 teddy_bear | мишка игрушка
🧳 luggage | чемодан
👓 glasses | очки
👕 tshirt | футболка
👖 jeans | джинсы
👗 dress | платье
👟 sneaker | кроссовок
👜 handbag | сумка
🎒 backpack | рюкзак
💍 ring | кольцо
📚 books | книги
📖 open_book read | книга читаю
🔖 bookmark | закладка
🏷~ label tag price | ярлык ценник
📢 loudspeaker announcement | объявление громкоговоритель
📣 megaphone | мегафон
🔔 bell notification | колокольчик уведомление
🔕 bell_off mute | без_звука
💬 speech_bubble chat message | сообщение чат
💭 thought_bubble | мысль
`,
  symbols: `
✅ check done yes | галочка готово да выполнено
✔~ check_mark ok | галочка
❌ cross no wrong | крестик нет ошибка
❎ cross_button | крестик
➕ plus add | плюс
➖ minus | минус
❗ exclamation important | восклицательный важно
❕ white_exclamation | восклицательный
❓ question | вопрос
❔ white_question | вопрос
⚠~ warning caution | внимание предупреждение
🚫 prohibited forbidden | запрещено нельзя
⛔ no_entry stop | стоп въезд_запрещен
🔞 adults_only | восемнадцать_плюс
💯 hundred perfect | сто идеально
🆗 ok_button | окей
🆕 new | новый новинка
🆓 free | бесплатно
🆙 up | вверх ап
🆒 cool_button | круто
🔝 top | топ
🔜 soon | скоро
🔙 back | назад
🔴 red_circle | красный круг
🟠 orange_circle | оранжевый круг
🟡 yellow_circle | желтый круг
🟢 green_circle online | зеленый круг онлайн
🔵 blue_circle | синий круг
🟣 purple_circle | фиолетовый круг
⚫ black_circle | черный круг
⚪ white_circle | белый круг
🔺 red_triangle up | треугольник
🔻 red_triangle_down | треугольник
🔸 orange_diamond | ромб
🔹 blue_diamond | ромб
⏩ fast_forward | перемотка вперед
⏪ rewind | перемотка назад
🔁 repeat | повтор
🔄 refresh update | обновить обновление
♻~ recycle | переработка
💤 zzz sleep | сон
💢 anger | злость
💥 boom collision | бум взрыв
💫 dizzy_star | звездочка
💦 sweat_drops | капли
💨 dash fast | быстро ветер
🎵 musical_note | нота музыка
🎶 musical_notes | ноты музыка
🔗 link | ссылка
🔰 beginner | новичок
⭕ circle | круг
🛑 stop_sign | стоп знак
🚩 red_flag | флажок флаг
🏁 checkered_flag finish | финиш флаг
🆘 sos help | помощь сос
🔍 search magnifier | поиск лупа
🔎 search_right | поиск лупа
`,
};

const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

let cache: Emoji[] | null = null;

/** All emojis, parsed once. */
export function allEmojis(): Emoji[] {
  if (cache) return cache;
  const out: Emoji[] = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const line of RAW[category].split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [left = '', right = ''] = trimmed.split('|');
      const [first = '', ...en] = left.trim().split(/\s+/);
      if (!first) continue;
      const char = first.endsWith('~') ? first.slice(0, -1) + VARIATION_SELECTOR : first;
      out.push({ char, category, en, ru: right.trim().split(/\s+/).filter(Boolean) });
    }
  }
  cache = out;
  return out;
}

/** Display name (first keyword) in the requested language. */
export function emojiName(e: Emoji, lang: 'en' | 'ru' | 'uk'): string {
  const list = lang === 'en' ? e.en : e.ru.length ? e.ru : e.en;
  return (list[0] ?? e.en[0] ?? '').replace(/_/g, ' ');
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** 2 = a keyword (or one of its words) equals the token, 1 = starts with it, 0 = no match. */
function tokenScore(token: string, keywords: readonly string[]): number {
  let best = 0;
  for (const kw of keywords) {
    const k = fold(kw);
    const parts = k.split('_');
    if (k === token || parts.includes(token)) return 2;
    if (k.startsWith(token) || parts.some((p) => p.startsWith(token))) best = 1;
  }
  return best;
}

/**
 * Search by English or Russian keywords (prefix matching, every word of the query must match).
 * An empty query returns the whole (optionally category-filtered) list.
 */
export function searchEmojis(
  query: string,
  opts: { category?: EmojiCategory; limit?: number } = {},
): Emoji[] {
  const list = opts.category ? allEmojis().filter((e) => e.category === opts.category) : allEmojis();
  const tokens = fold(query.trim()).split(/\s+/).filter(Boolean);
  const limit = opts.limit ?? 200;
  if (tokens.length === 0) return list.slice(0, limit);
  const scored: { e: Emoji; score: number; i: number }[] = [];
  list.forEach((e, i) => {
    if (tokens.length === 1 && e.char.startsWith(tokens[0]!)) {
      scored.push({ e, score: 100, i });
      return;
    }
    let total = 0;
    for (const t of tokens) {
      const s = tokenScore(t, [...e.en, ...e.ru]);
      if (s === 0) return;
      total += s;
    }
    scored.push({ e, score: total, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Emoji objects for recently used characters (unknown characters are kept as minimal entries). */
export function resolveRecent(chars: readonly string[]): Emoji[] {
  const byChar = new Map(allEmojis().map((e) => [e.char, e]));
  return chars.map((c) => byChar.get(c) ?? { char: c, category: 'symbols', en: [], ru: [] });
}
