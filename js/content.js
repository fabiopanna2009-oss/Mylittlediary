// content.js — the words of the app: kinds of pages, moods, writing prompts, starting collections.
// Change anything here to make the diary even more yours.

// The different kinds of pages in the book.
export const KINDS = {
  entry:   { label: 'Pages',            one: 'A page',          emptyTitle: 'Untitled' },
  thought: { label: 'Thoughts',         one: 'A thought',       emptyTitle: 'A thought' },
  letter:  { label: 'Letters',          one: 'A letter',        emptyTitle: 'An unsent letter' },
  memory:  { label: 'Memories',         one: 'A memory',        emptyTitle: 'A memory' },
  detail:  { label: 'Details',          one: 'A little detail', emptyTitle: 'A little detail' },
};

// Moods are feelings, not scores. Shown as words, quietly.
export const MOODS = [
  { id: 'happy',     label: 'Happy' },
  { id: 'calm',      label: 'Calm' },
  { id: 'grateful',  label: 'Grateful' },
  { id: 'nostalgic', label: 'Nostalgic' },
  { id: 'longing',   label: 'Longing' },
  { id: 'sad',       label: 'Sad' },
  { id: 'tired',     label: 'Tired' },
];

export const moodById = (id) => MOODS.find((m) => m.id === id) || null;

// Gentle prompts. They are only suggestions, never required.
export const PROMPTS = [
  'What made you smile today, even a little?',
  'Describe a place where you feel at home.',
  'What would you want to remember about today in ten years?',
  'Write about a sound you love.',
  'Which moment do you keep replaying in your mind?',
  'What are you grateful for tonight?',
  'What did you learn about yourself this week?',
  'Describe a smell that brings back a memory.',
  'What do you need right now?',
  'Write about a song that feels like a certain time in your life.',
  'What is something small you never want to forget?',
  'If today were a colour, which one would it be and why?',
  'Who made your day better, and how?',
  'What is something you are looking forward to?',
  'Describe the last time you laughed really hard.',
  'Write about a conversation you think about often.',
  'What would you tell yourself one year ago?',
  'What is something you are proud of, even if nobody saw it?',
  'Describe a perfect, ordinary day.',
  'What does your heart feel heavy or light about today?',
  'Write about a photo you love and the story behind it.',
  'What is a little thing that makes you feel safe?',
  'Which season feels most like you, and why?',
  'What are you still hoping for?',
  'Write down three tiny good things from today.',
  'Describe someone using only the little details you remember.',
  'What is something you wish you had said?',
  'How did you take care of yourself today?',
];

export const LETTER_PROMPTS = [
  'Something I never told you…',
  'Today I thought of you when…',
  'I remember the day when…',
  'If you could read this, I would want you to know…',
];

export const DETAIL_PROMPTS = [
  'The way she laughs…',
  'Her voice when…',
  'The way she smiled at…',
  'Something she always says…',
  'What she wore that day…',
];

// The prompt of the day stays the same all day.
export function promptOfTheDay(date = new Date()) {
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return PROMPTS[dayNumber % PROMPTS.length];
}

export function randomFrom(list, avoid) {
  if (list.length < 2) return list[0];
  let pick;
  do { pick = list[Math.floor(Math.random() * list.length)]; } while (pick === avoid);
  return pick;
}

// Collections created the very first time the app opens. You can rename or delete them,
// and add your own in the app (they are then saved only on your phone, not in this code).
export const STARTER_COLLECTIONS = [
  'School memories',
  'Italian class',
  'Cooking class',
  'PE',
  'Little moments',
  'Things I miss',
];
