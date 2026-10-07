/**
 * The only client-side script in the project. When a student starts one
 * recording, pause the others, so two performances of the same spiritual
 * cannot play over each other.
 */
document.addEventListener(
  'play',
  (event) => {
    const started = event.target;
    if (!(started instanceof HTMLAudioElement)) return;
    for (const other of document.querySelectorAll('audio')) {
      if (other !== started) other.pause();
    }
  },
  true, // capture, because `play` does not bubble
);
