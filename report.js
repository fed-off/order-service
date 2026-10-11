// report.js — АВТОГЕНЕРАЦИЯ скриптом parse.js вместе с data.js. Не редактировать вручную.
// Показывается на странице report.html: что не попало в базу и почему, статистика обновления.

const REPORT = {
  "generatedAt": "2026-10-11T19:19:07.549Z",
  "sourceModifiedAt": "2026-10-11T19:05:35.658Z",
  "backupFile": "data.2026-10-11_21-19-07.js",
  "columns": {
    "product": {
      "letter": "A",
      "header": "Изделие"
    },
    "parts": {
      "letter": "O",
      "header": "перечень деталей"
    },
    "fileName": {
      "letter": "P",
      "header": "Название файла"
    },
    "machine": {
      "letter": "Q",
      "header": "номер станка"
    },
    "distance": {
      "letter": "R",
      "header": "Расстояние между головами см."
    },
    "heads": {
      "letter": "U",
      "header": "количество голов"
    },
    "abTime": {
      "letter": "AB",
      "header": "время резки (часы:мин.:сек.)"
    },
    "time": {
      "letter": "AD",
      "header": "Итого время на файл"
    }
  },
  "stats": {
    "products": 78,
    "files": 108,
    "files2": 79,
    "files4": 30,
    "filesBoth": 1,
    "sheetRowsWithFile": 142,
    "excludedRows": 33,
    "missingFiles": 11,
    "missingProducts": [
      "Коробочка НГ из фанеры",
      "Табличка Баня"
    ]
  },
  "excluded": [
    {
      "sheetRows": [
        121
      ],
      "values": {
        "product": "Ключ Здравствуй школа",
        "parts": "Ключ (готовое изделие)",
        "fileName": "KLUCH6",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        124
      ],
      "values": {
        "product": "Ключ Вперед к знаниям",
        "parts": "Ключ (готовое изделие)",
        "fileName": "KLUCH2",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:01:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        128
      ],
      "values": {
        "product": "Ключ к знаниям",
        "parts": "Ключ ( готовое изделие )",
        "fileName": "KLUCH3",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:01:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        133
      ],
      "values": {
        "product": "Ключ первоклассница 2025",
        "parts": "Ключ ( отовое изделие)",
        "fileName": "KLUCH5",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:01:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        170
      ],
      "values": {
        "product": "Медаль Первоклассник 1 А класс",
        "parts": "верхняя часть медали",
        "fileName": "PM1A",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        176
      ],
      "values": {
        "product": "Медаль Первоклассник 1 Б класс",
        "parts": "верхняя часть медали",
        "fileName": "PM1B",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        179
      ],
      "values": {
        "product": "Медаль Первоклассница 1 Б класс",
        "parts": "верхняя часть медали",
        "fileName": "PD1B",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        198,
        199,
        200
      ],
      "values": {
        "product": "Коробочка НГ из фанеры",
        "parts": "перед, зад, бока",
        "fileName": "NOVGOD",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:00:00",
        "machine": "1, 3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        201,
        202,
        203
      ],
      "values": {
        "product": "Коробочка НГ из фанеры",
        "parts": "дно",
        "fileName": "DNO",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:00:00",
        "machine": "1, 3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        204,
        205,
        206
      ],
      "values": {
        "product": "Коробочка НГ из фанеры",
        "parts": "крышка",
        "fileName": "KRISHKI",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:00:00",
        "machine": "1, 3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        207,
        208,
        209
      ],
      "values": {
        "product": "Коробочка НГ из фанеры",
        "parts": "Снежинка",
        "fileName": "SNEZHIN2",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:00:00",
        "machine": "1, 3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        212,
        213
      ],
      "values": {
        "product": "Коробочка НГ из ЛХДФ",
        "parts": "дно, крышка, перед, зад, бока 2 шт, грибки",
        "fileName": "NGLHDF",
        "distance": "70,00",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        214,
        215,
        216
      ],
      "values": {
        "product": "Коробочка НГ из ЛХДФ",
        "parts": "Снежинка",
        "fileName": "SNEZHIN2",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "1, 3, 4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        218,
        219
      ],
      "values": {
        "product": "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "parts": "перед, зад, бок правый, бок левый",
        "fileName": "SNEGUR2",
        "distance": "75,50",
        "heads": "2",
        "abTime": "0:00:00",
        "time": "0:03:00",
        "machine": "1, 3"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        221,
        222
      ],
      "values": {
        "product": "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "parts": "Дно",
        "fileName": "novdno",
        "distance": "75,50",
        "heads": "2",
        "abTime": "0:00:00",
        "time": "0:03:00",
        "machine": "1, 3"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        224,
        225
      ],
      "values": {
        "product": "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "parts": "Крышки",
        "fileName": "novkr",
        "distance": "75,50",
        "heads": "2",
        "abTime": "0:00:00",
        "time": "0:03:00",
        "machine": "1, 3"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        227
      ],
      "values": {
        "product": "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "parts": "Грибки",
        "fileName": "gribki",
        "distance": "75,50",
        "heads": "2",
        "abTime": "0:00:00",
        "time": "0:03:00",
        "machine": "4"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        254
      ],
      "values": {
        "product": "Табличка Баня",
        "parts": "подложка, основная часть.",
        "fileName": "banya",
        "distance": "75,50",
        "heads": "2",
        "abTime": "",
        "time": "0:03:00",
        "machine": "1"
      },
      "issues": [
        {
          "kind": "empty",
          "field": "abTime",
          "msg": "не заполнено время резки"
        }
      ]
    },
    {
      "sheetRows": [
        282
      ],
      "values": {
        "product": "Книжки мамины сокровища",
        "parts": "обложки для книжки",
        "fileName": "KNIGAOBL",
        "distance": "45 800,00",
        "heads": "4",
        "abTime": "0:09:29",
        "time": "0:10:29",
        "machine": "5"
      },
      "issues": [
        {
          "kind": "bad",
          "field": "distance",
          "msg": "пробел внутри числа — уберите пробелы (формат: 75,5)"
        }
      ]
    }
  ],
  "attention": [
    {
      "sheetRows": [
        263
      ],
      "values": {
        "product": "Итого Табличка Гараж именная ГОТОВАЯ",
        "parts": "подложка для именного гаража",
        "fileName": "garagpod",
        "distance": "63,00",
        "heads": "2",
        "abTime": "0:04:15",
        "time": "0:07:15",
        "machine": "4"
      },
      "field": "product",
      "msg": "файл стоит в строке «Итого» — в базе он попал в отдельное изделие с этим названием"
    }
  ],
  "sharedFiles": [
    {
      "fileName": "podlozh",
      "products": [
        "Подложка для медалей",
        "Медаль Первоклассник 1 А класс",
        "Медаль Первоклассница 1 А класс",
        "Медаль Первоклассник 1 Б класс",
        "Медаль Первоклассница 1 Б класс",
        "Медаль Первоклассник 1 В класс",
        "Медаль Первоклассница 1 В класс"
      ]
    },
    {
      "fileName": "novdno",
      "products": [
        "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "Крестильный набор"
      ]
    },
    {
      "fileName": "novkr",
      "products": [
        "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "Крестильный набор"
      ]
    },
    {
      "fileName": "gribki",
      "products": [
        "Коробка НГ (Снегурка 2) большая в разобранном виде из фанеры",
        "Крестильный набор"
      ]
    },
    {
      "fileName": "garagpod",
      "products": [
        "Итого Табличка Гараж именная ГОТОВАЯ",
        "Табличка Гараж именная заготовка"
      ]
    }
  ],
  "changes": {
    "addedProducts": [],
    "removedProducts": [],
    "addedFiles": [],
    "removedFiles": [],
    "changedFiles": []
  }
};

if (typeof module !== 'undefined' && module.exports) { module.exports = REPORT; }
