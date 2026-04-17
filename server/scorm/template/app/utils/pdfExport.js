// PDF Export Utility - Генерация красивого PDF с подложкой
// Использует html2canvas для рендеринга HTML в картинку

var pdfAssets = {
  backgrounds: [],
  logo: null,
  loaded: false
};

// Загрузка изображения как Data URL
function loadImageAsDataUrl(src) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        width: img.width,
        height: img.height
      });
    };
    img.onerror = function () {
      console.warn('⚠️ Не удалось загрузить:', src);
      resolve(null);
    };
    img.src = src;
  });
}

// Загрузка всех PDF-ассетов
async function loadPdfAssets() {
  if (pdfAssets.loaded) return;

  console.log('🔍 Загружаем PDF ассеты...');

  var basePath = 'assets/media/';

  var bg1 = await loadImageAsDataUrl(basePath + 'pdf-bg-1.png');
  var bg2 = await loadImageAsDataUrl(basePath + 'pdf-bg-2.png');
  var bg3 = await loadImageAsDataUrl(basePath + 'pdf-bg-3.png');
  var logo = await loadImageAsDataUrl(basePath + 'logo-light.png');

  if (bg1) pdfAssets.backgrounds.push(bg1);
  if (bg2) pdfAssets.backgrounds.push(bg2);
  if (bg3) pdfAssets.backgrounds.push(bg3);
  pdfAssets.logo = logo;

  pdfAssets.loaded = true;
  console.log('✅ PDF ассеты загружены:', pdfAssets.backgrounds.length, 'подложек');
}

// Генерация HTML для PDF
function generatePdfHtml(results, testName, bgDataUrl, logoDataUrl, learnerName, timestamp) {
  var percent = Math.round(results.percent);
  var passed = results.passed;
  var attempts = typeof getAllAttempts === 'function' ? getAllAttempts().length : 1;

  var statusColor = passed ? '#22c55e' : '#ef4444';
  var statusText = passed ? 'Тест пройден' : 'Тест не пройден';
  var statusBadge = passed ? 'пройден' : 'не пройден';
  var statusBadgeBg = passed ? 'rgba(34, 197, 94, 0.2)' : '#432027';
  var statusBadgeBorder = passed ? '#22c55e' : '#eb1e1e';
  var statusBadgeColor = passed ? '#22c55e' : '#ff3131';

  // Определяем количество колонок для тем (макс 3)
  var topicCount = results.topicResults ? results.topicResults.length : 0;
  var gridColumns = topicCount === 1 ? 1 : (topicCount === 2 ? 2 : 3);

  // Фон
  var bgStyle = bgDataUrl
    ? 'background-image: url(' + bgDataUrl + '); background-size: cover; background-position: center;'
    : 'background: linear-gradient(180deg, #1c1c2b 0%, #7700ff 100%);';

  var html = '';
  html += '<div style="' + bgStyle + ' width: 595px; min-height: 842px; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; color: #ffffff; position: relative;">';
  html += '<div style="padding: 20px 25px;">';

  // Логотип
  if (logoDataUrl) {
    html += '<div style="margin-bottom: 15px;">';
    html += '<img src="' + logoDataUrl + '" style="height: 32px;" />';
    html += '</div>';
  }

  // Главный заголовок
  html += '<div style="font-size: 42px; font-weight: 900; margin-bottom: 4px; line-height: 1; color: ' + (passed ? '#22c55e' : '#ffffff') + ';">' + escapeHtml(statusText) + '</div>';
  html += '<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 8px;">Лучший результат за ' + attempts + ' ' + pluralize(attempts, 'попытку', 'попытки', 'попыток') + '</div>';
  if (learnerName) {
    html += '<div style="font-size: 13px; color: #ffffff; margin-bottom: 4px;">Слушатель: ' + escapeHtml(learnerName) + '</div>';
  }
  html += '<div style="font-size: 12px; color: #aca9a9; margin-bottom: 15px;">Дата прохождения: ' + escapeHtml(formatTimestamp(timestamp)) + '</div>';

  // Карточка с результатами
  html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
  html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 4px;">' + escapeHtml(testName || 'Результаты теста') + '</div>';
  html += '<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 20px;">Результат теста</div>';

  // Секция с метриками
  html += '<div style="display: flex; align-items: center; gap: 20px;">';

  // Метрики
  html += '<div style="display: flex; gap: 30px;">';
  html += createMetric(results.totalQuestions, 'вопросов');
  html += createMetric((results.totalCorrect || results.correct) + '/' + results.totalQuestions, 'верно');
  html += createMetric(results.earnedPoints.toFixed(1), 'баллов');
  html += '</div>';

  // Круг с процентом (SVG)
  var circumference = 2 * Math.PI * 44;
  var offset = circumference - (circumference * percent / 100);
  html += '<div style="width: 100px; height: 100px; position: relative; display: flex; align-items: center; justify-content: center;">';
  html += '<svg viewBox="0 0 100 100" style="position: absolute; width: 100%; height: 100%; transform: rotate(-90deg);">';
  html += '<circle cx="50" cy="50" r="44" fill="none" stroke="#2f2f2f" stroke-width="12"/>';
  html += '<circle cx="50" cy="50" r="44" fill="none" stroke="' + statusColor + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '"/>';
  html += '</svg>';
  html += '<div style="font-size: 28px; font-weight: 900; z-index: 1;">' + percent + '%</div>';
  html += '</div>';

  // Бейдж статуса
  html += '<div style="margin-left: auto; padding: 10px 20px; border-radius: 50px; font-size: 12px; font-weight: 500; background: ' + statusBadgeBg + '; border: 2px solid ' + statusBadgeBorder + '; color: ' + statusBadgeColor + ';">' + statusBadge + '</div>';

  html += '</div>'; // score-section
  html += '</div>'; // info-card

  // Результаты по темам
  if (topicCount > 0) {
    html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 15px;">Результаты по темам</div>';

    html += '<div style="display: grid; grid-template-columns: repeat(' + gridColumns + ', 1fr); gap: 10px;">';

    results.topicResults.forEach(function (topic) {
      var topicPercent = Math.round(topic.percent);
      var topicPassed = topic.passed;
      var topicColor = topicPassed ? '#22c55e' : '#ef4444';
      var topicStatusBg = topicPassed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';

      html += '<div style="background: linear-gradient(135deg, #2a2a3d 0%, #1f1f2e 100%); border-radius: 10px; padding: 10px; position: relative; overflow: hidden;">';

      // Верхняя полоса
      html += '<div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ' + topicColor + ';"></div>';

      // Заголовок темы
      html += '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 5px;">';
      html += '<div style="font-size: 12px; font-weight: 700; line-height: 1.2; flex: 1;">' + escapeHtml(topic.topicName || 'Тема') + '</div>';
      html += '<div style="font-size: 6px; font-weight: 500; padding: 2px 6px; border-radius: 3px; white-space: nowrap; background: ' + topicStatusBg + '; color: ' + topicColor + ';">' + (topicPassed ? 'Пройден' : 'Не пройден') + '</div>';
      html += '</div>';

      // Статистика
      html += '<div style="display: flex; justify-content: space-between; font-size: 7px; color: #aca9a9; margin-bottom: 5px;">';
      html += '<span>' + topic.correct + ' из ' + topic.total + ' (' + topicPercent + '%)</span>';
      html += '<span>' + topic.earnedPoints.toFixed(1) + '/' + topic.possiblePoints.toFixed(1) + '</span>';
      html += '</div>';

      // Прогресс-бар
      html += '<div style="height: 3px; background: #2f2f2f; border-radius: 2px; overflow: hidden; margin-bottom: 6px;">';
      html += '<div style="height: 100%; width: ' + topicPercent + '%; background: ' + topicColor + '; border-radius: 2px;"></div>';
      html += '</div>';

      // Обратная связь (только для непройденных)
      if (!topicPassed && topic.topicFeedback && topic.topicFeedback.trim()) {
        html += '<div style="font-size: 10px; font-weight: 300; color: rgba(255, 255, 255, 0.7); line-height: 1.3; margin-top: 4px;">' + escapeHtml(topic.topicFeedback) + '</div>';
      }

      html += '</div>'; // topic-card
    });

    html += '</div>'; // topics-grid
    html += '</div>'; // section-card
  }

  // Рекомендации по курсам (только для непройденных тем, без дублей)
  var seenPdfCourses = {};
  var seenPdfEvents = {};
  var pdfCourses = [];
  var pdfEvents = [];
  if (results.topicResults) {
    results.topicResults.forEach(function (topic) {
      if (!topic.passed) {
        var section = TEST_DATA && TEST_DATA.sections
          ? TEST_DATA.sections.find(function(s) { return s.topicId === topic.topicId; })
          : null;
        var courses = (section && section.recommendedCourses && section.recommendedCourses.length > 0)
          ? section.recommendedCourses
          : (topic.recommendedCourses || []);
        var events = (section && section.recommendedEvents) ? section.recommendedEvents : [];

        courses.forEach(function (course) {
          if (!seenPdfCourses[course.title]) {
            seenPdfCourses[course.title] = true;
            pdfCourses.push({ courseTitle: course.title, courseUrl: course.url });
          }
        });
        events.forEach(function (ev) {
          if (!seenPdfEvents[ev.title]) {
            seenPdfEvents[ev.title] = true;
            pdfEvents.push({ eventTitle: ev.title });
          }
        });
      }
    });
  }

  if (pdfCourses.length > 0) {
    html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендации по курсам</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Изучите эти материалы для улучшения знаний по темам, которые требуют внимания.</div>';

    pdfCourses.forEach(function(rec, index) {
      html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
      html += '<div class="pdf-link-btn" data-url="' + escapeHtml(rec.courseUrl) + '" data-index="' + index + '" style="background: #59209b; border-radius: 8px; padding: 10px 25px; font-size: 12px; font-weight: 300; color: #fafafa;">' + escapeHtml(rec.courseTitle) + '</div>';
      html += '</div>';
    });

    html += '</div>'; // courses recommendations
  }

  if (pdfEvents.length > 0) {
    html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендуемые мероприятия</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Посетите очные мероприятия для углублённого изучения материала.</div>';

    pdfEvents.forEach(function(rec) {
      html += '<div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
      html += '<div style="font-size: 14px; font-weight: 300; color: #fafafa;">' + escapeHtml(rec.eventTitle) + '</div>';
      html += '</div>';
    });

    html += '</div>'; // events recommendations
  }

  html += '</div>'; // padding
  html += '</div>'; // page

  return html;
}

// Генерация HTML для PDF адаптивного теста
function generateAdaptivePdfHtml(results, testName, bgDataUrl, logoDataUrl, learnerName, timestamp) {
  // Определяем количество колонок для тем (макс 3)
  var topicCount = results.topicResults ? results.topicResults.length : 0;
  var gridColumns = topicCount === 1 ? 1 : (topicCount === 2 ? 2 : 3);

  // Фон
  var bgStyle = bgDataUrl
    ? 'background-image: url(' + bgDataUrl + '); background-size: cover; background-position: center;'
    : 'background: linear-gradient(180deg, #1c1c2b 0%, #7700ff 100%);';

  var html = '';
  html += '<div style="' + bgStyle + ' width: 595px; min-height: 842px; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; color: #ffffff; position: relative;">';
  html += '<div style="padding: 20px 25px;">';

  // Логотип
  if (logoDataUrl) {
    html += '<div style="margin-bottom: 15px;">';
    html += '<img src="' + logoDataUrl + '" style="height: 32px;" />';
    html += '</div>';
  }

  // Главный заголовок (нейтральный)
  html += '<div style="font-size: 42px; font-weight: 900; margin-bottom: 4px; line-height: 1; color: #ffffff;">Результаты теста</div>';
  html += '<div style="font-size: 14px; font-weight: 300; color: #aca9a9; margin-bottom: 8px;">Адаптивное тестирование</div>';
  if (learnerName) {
    html += '<div style="font-size: 13px; color: #ffffff; margin-bottom: 4px;">Слушатель: ' + escapeHtml(learnerName) + '</div>';
  }
  html += '<div style="font-size: 12px; color: #aca9a9; margin-bottom: 15px;">Дата прохождения: ' + escapeHtml(formatTimestamp(timestamp)) + '</div>';

  // Карточка с названием теста
  html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
  html += '<div style="font-size: 22px; font-weight: 500;">' + escapeHtml(testName || 'Тест') + '</div>';
  html += '</div>';

  // Результаты по темам
  if (topicCount > 0) {
    html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 15px;">Результаты по темам</div>';

    html += '<div style="display: grid; grid-template-columns: repeat(' + gridColumns + ', 1fr); gap: 10px;">';

    results.topicResults.forEach(function (topic) {
      var achieved = topic.achievedLevelIndex !== null;
      var levelName = achieved ? topic.achievedLevelName : 'Не достигнут';
      var levelColor = achieved ? '#3b82f6' : '#6b7280';
      var levelBg = achieved ? 'rgba(59, 130, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)';

      html += '<div style="background: linear-gradient(135deg, #2a2a3d 0%, #1f1f2e 100%); border-radius: 10px; padding: 12px; position: relative; overflow: hidden;">';

      // Верхняя полоса (нейтральный синий)
      html += '<div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ' + levelColor + ';"></div>';

      // Заголовок темы
      html += '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 5px;">';
      html += '<div style="font-size: 13px; font-weight: 700; line-height: 1.2; flex: 1;">' + escapeHtml(topic.topicName || 'Тема') + '</div>';
      html += '<div style="font-size: 9px; font-weight: 500; padding: 3px 8px; border-radius: 4px; white-space: nowrap; background: ' + levelBg + '; color: ' + levelColor + ';">' + escapeHtml(levelName) + '</div>';
      html += '</div>';

      // Статистика
      html += '<div style="font-size: 11px; color: #aca9a9; margin-bottom: 6px;">';
      html += 'Вопросов: ' + topic.totalQuestionsAnswered + ' | Правильных: ' + topic.totalCorrect;
      html += '</div>';

      // Обратная связь к теме
      if (topic.feedback && topic.feedback.trim()) {
        html += '<div style="font-size: 10px; font-weight: 300; color: rgba(255, 255, 255, 0.8); line-height: 1.4; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">' + escapeHtml(topic.feedback) + '</div>';
      }

      html += '</div>'; // topic-card
    });

    html += '</div>'; // topics-grid
    html += '</div>'; // section-card
  }

  // Рекомендации по курсам
  var recommendations = [];
  if (results.topicResults) {
    results.topicResults.forEach(function (topic) {
      if (topic.recommendedLinks && topic.recommendedLinks.length > 0) {
        topic.recommendedLinks.forEach(function (link) {
          recommendations.push({
            topicName: topic.topicName,
            linkTitle: link.title,
            linkUrl: link.url
          });
        });
      }
    });
  }

  if (recommendations.length > 0) {
    html += '<div style="background: rgba(31, 33, 41, 0.68); border-radius: 18px; padding: 18px 20px; margin-bottom: 15px;">';
    html += '<div style="font-size: 22px; font-weight: 400; margin-bottom: 8px;">Рекомендуемые материалы</div>';
    html += '<div style="font-size: 11px; font-weight: 300; color: #aca9a9; margin-bottom: 15px; line-height: 1.5;">Изучите эти материалы для улучшения знаний.</div>';
    
    recommendations.forEach(function(rec, index) {
      html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
      html += '<div style="font-size: 14px; font-weight: 700;">' + escapeHtml(rec.topicName) + '</div>';
      html += '<div class="pdf-link-btn" data-url="' + escapeHtml(rec.linkUrl) + '" data-index="' + index + '" style="background: #1e40af; border-radius: 8px; padding: 10px 25px; font-size: 12px; font-weight: 300; color: #fafafa;">' + escapeHtml(rec.linkTitle) + '</div>';
      html += '</div>';
    });
    
    html += '</div>'; // recommendations
  }

  html += '</div>'; // padding
  html += '</div>'; // page

  return html;
}

function createMetric(value, label) {
  return '<div style="text-align: center;">' +
    '<div style="font-size: 28px; font-weight: 900;">' + value + '</div>' +
    '<div style="font-size: 12px; font-weight: 300; color: #aca9a9;">' + label + '</div>' +
    '</div>';
}

function pluralize(n, one, few, many) {
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function sanitizeFileName(name) {
  if (!name) return 'test';
  return name.replace(/[^a-zA-Zа-яА-Я0-9_\-\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
}

function formatDate(date) {
  var d = date.getDate().toString().padStart(2, '0');
  var m = (date.getMonth() + 1).toString().padStart(2, '0');
  var y = date.getFullYear();
  return d + '_' + m + '_' + y;
}

function formatTimestamp(isoString) {
  var d = isoString ? new Date(isoString) : new Date();
  var day = d.getDate().toString().padStart(2, '0');
  var month = (d.getMonth() + 1).toString().padStart(2, '0');
  var year = d.getFullYear();
  var hours = d.getHours().toString().padStart(2, '0');
  var minutes = d.getMinutes().toString().padStart(2, '0');
  return day + '.' + month + '.' + year + ' ' + hours + ':' + minutes;
}

// Главная функция экспорта
async function exportResultsToPDF(results, testName, learnerName, timestamp) {
  // Создаём оверлей загрузки
  var overlay = document.createElement('div');
  overlay.id = 'pdf-loading-overlay';
  overlay.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">' +
    '<div style="width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: pdf-spin 1s linear infinite;"></div>' +
    '<div style="font-size: 18px; font-weight: 500;">Генерация PDF...</div>' +
    '<div style="font-size: 14px; opacity: 0.7;">Это может занять некоторое время</div>' +
    '</div>';
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999; color: #fff; font-family: Inter, sans-serif;';

  // Добавляем анимацию
  var style = document.createElement('style');
  style.textContent = '@keyframes pdf-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  try {
    console.log('📄 Начинаем генерацию PDF...');

    // Загружаем ассеты
    await loadPdfAssets();

    // Проверяем библиотеки
    var jsPDF = window.jspdf && window.jspdf.jsPDF;
    var html2canvas = window.html2canvas;

    if (!jsPDF || !html2canvas) {
      throw new Error('Библиотеки jsPDF или html2canvas не загружены');
    }

    // Выбираем случайную подложку
    var bgDataUrl = null;
    if (pdfAssets.backgrounds.length > 0) {
      var randomIndex = Math.floor(Math.random() * pdfAssets.backgrounds.length);
      bgDataUrl = pdfAssets.backgrounds[randomIndex].dataUrl;
      console.log('🎨 Выбрана подложка:', randomIndex + 1);
    }

    var logoDataUrl = pdfAssets.logo ? pdfAssets.logo.dataUrl : null;

    // Генерируем HTML (выбираем функцию в зависимости от режима)
    var isAdaptive = TEST_DATA.mode === 'adaptive';
    var htmlContent = isAdaptive
      ? generateAdaptivePdfHtml(results, testName, bgDataUrl, logoDataUrl, learnerName, timestamp)
      : generatePdfHtml(results, testName, bgDataUrl, logoDataUrl, learnerName, timestamp);
    // Создаём временный контейнер
    var container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    // Ждём рендеринга
    await new Promise(function (resolve) { setTimeout(resolve, 100); });

    // Рендерим в canvas
    var canvas = await html2canvas(container.firstChild, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false
    });

    // Удаляем контейнер
    // document.body.removeChild(container);

    // Вычисляем размеры
    var imgWidth = 210; // A4 ширина в мм
    var imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Собираем позиции ссылок до удаления контейнера
    var linkButtons = container.querySelectorAll('.pdf-link-btn');
    var links = [];
    var containerRect = container.firstChild.getBoundingClientRect();
    
    linkButtons.forEach(function(btn) {
      var rect = btn.getBoundingClientRect();
      links.push({
        url: btn.getAttribute('data-url'),
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height
      });
    });
    
    // Удаляем контейнер
    document.body.removeChild(container);
    
    // Вычисляем размеры
    var imgWidth = 210; // A4 ширина в мм
    var imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    // Коэффициент масштабирования (пиксели → мм)
    var scale = imgWidth / 595; // 595px - ширина контейнера
    
    // Создаём PDF
    var pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [imgWidth, Math.max(imgHeight, 297)]
    });
    
    var imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
    
    // Добавляем кликабельные ссылки
    links.forEach(function(link) {
      if (link.url) {
        pdf.link(
          link.x * scale,
          link.y * scale,
          link.width * scale,
          link.height * scale,
          { url: link.url, newWindow: true }
        );
      }
    });
    
    // Сохраняем
    var fileName = 'Результаты_' + sanitizeFileName(testName) + '_' + formatDate(new Date()) + '.pdf';
    pdf.save(fileName);

    console.log('✅ PDF сгенерирован:', fileName);
    
    // Убираем оверлей
    var overlayToRemove = document.getElementById('pdf-loading-overlay');
    if (overlayToRemove) overlayToRemove.remove();
    
    return true;
    
  } catch (error) {
    console.error('❌ Ошибка генерации PDF:', error);
    
    // Убираем оверлей при ошибке
    var overlayToRemove = document.getElementById('pdf-loading-overlay');
    if (overlayToRemove) overlayToRemove.remove();
    
    alert('Ошибка при экспорте PDF: ' + error.message);
    return false;
  }
}