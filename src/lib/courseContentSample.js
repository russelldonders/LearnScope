// Illustrative course content for previewing the learner-facing "content
// player" experience (src/pages/CourseLearn.jsx) ahead of building a real
// content editor/creator. Not persisted anywhere and not tied to any real
// course's actual syllabus -- it exists purely to explore the layout and
// interaction with something that reads like real material rather than
// lorem ipsum.
export const SAMPLE_MODULES = [
  {
    id: 'm1',
    title: 'Getting Started',
    lessons: [
      {
        id: 'l1',
        title: 'Welcome & overview',
        type: 'video',
        duration: '4 min',
        body: {
          description:
            "A quick tour of what you'll cover, how the modules build on each other, and what you should be able to do by the end.",
        },
      },
      {
        id: 'l2',
        title: 'Setting up your environment',
        type: 'reading',
        duration: '6 min',
        body: {
          paragraphs: [
            "Before diving into the material, make sure you've got everything installed and configured -- there's nothing worse than getting stuck on setup instead of the actual subject.",
            'Follow the steps in order. If something looks different from what’s described, it usually means a version has moved on since this was written -- the underlying idea still applies.',
          ],
        },
      },
    ],
  },
  {
    id: 'm2',
    title: 'Core Concepts',
    lessons: [
      {
        id: 'l3',
        title: 'Key principles',
        type: 'video',
        duration: '12 min',
        body: {
          description:
            'The handful of ideas that everything else in this course builds on. Worth watching twice -- the second pass is usually where it clicks.',
        },
      },
      {
        id: 'l4',
        title: 'Worked examples',
        type: 'reading',
        duration: '8 min',
        body: {
          paragraphs: [
            "Three examples, from simple to more involved, each walked through step by step so you can see the principles from the last lesson actually being applied.",
            "Try to predict the next step before reading it -- that's a better test of whether it's landed than just following along.",
          ],
        },
      },
      {
        id: 'l5',
        title: 'Check your understanding',
        type: 'quiz',
        duration: '5 min',
        body: {
          question: 'Which of these best describes the core idea from this module?',
          options: [
            'Apply the same fixed process every time, regardless of context',
            'Adapt the underlying principle to the situation in front of you',
            'Skip straight to advanced techniques once you know the basics',
            'Memorize the worked examples exactly as shown',
          ],
          correctIndex: 1,
          explanation:
            'The principle is meant to be adapted, not applied mechanically -- the worked examples showed three different situations precisely to make that point.',
        },
      },
    ],
  },
  {
    id: 'm3',
    title: 'Applying What You’ve Learned',
    lessons: [
      {
        id: 'l6',
        title: 'Guided exercise',
        type: 'exercise',
        duration: '20 min',
        body: {
          description:
            "A hands-on exercise to practice with, using a realistic scenario rather than a toy example. Work through it at your own pace -- there's no single right answer, only stronger and weaker approaches.",
          resourceName: 'exercise-worksheet.pdf',
        },
      },
      {
        id: 'l7',
        title: 'Case study',
        type: 'video',
        duration: '15 min',
        body: {
          description:
            'A real-world walkthrough of someone applying this in practice, including the parts that didn’t go to plan and how they adjusted.',
        },
      },
    ],
  },
  {
    id: 'm4',
    title: 'Wrapping Up',
    lessons: [
      {
        id: 'l8',
        title: 'Summary & next steps',
        type: 'reading',
        duration: '5 min',
        body: {
          paragraphs: [
            "A recap of everything covered, plus a few pointers on where to go next depending on which direction you want to take this.",
          ],
        },
      },
      {
        id: 'l9',
        title: 'Final knowledge check',
        type: 'quiz',
        duration: '10 min',
        body: {
          question: 'Looking back across the whole course, what should you be able to do now that you couldn’t before?',
          options: [
            'Recite the definitions from Module 1',
            'Recognize the pattern and apply it to a new situation on your own',
            'List every example covered in order',
            'Explain the history of the subject',
          ],
          correctIndex: 1,
          explanation:
            "That's the actual goal -- being able to transfer it to something new, not recall what was shown.",
        },
      },
    ],
  },
]
