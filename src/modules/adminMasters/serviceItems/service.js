const {
  createAdminMasterService,
  ensureForeignKey,
  ensureUniqueComposite,
  resolveSlug,
  prisma
} = require('../common');

const serviceItemSelect = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  defaultPrice: true,
  estimatedMinutes: true,
  isActive: true,
  createdById: true,
  modifiedById: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
};

const baseService = createAdminMasterService({
  model: 'serviceItem',
  identifierField: 'slug',
  tableName: 'service_items',
  label: 'Service item',
  select: serviceItemSelect,
  fields: [
    { name: 'categoryId', type: 'int', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'description', type: 'string' },
    { name: 'defaultPrice', type: 'decimal', required: true },
    { name: 'estimatedMinutes', type: 'optionalInt' },
    { name: 'isActive', type: 'boolean' }
  ],
  hasIsActive: true,
  hasCreatedById: true,
  hasModifiedById: true,
  slugFrom: 'name',
  searchFields: ['name', 'slug', 'description', 'category.name'],
  filterFields: ['categoryId'],
  validateRelations: async (data) => {
    await ensureForeignKey({ model: 'serviceCategory', id: data.categoryId, label: 'categoryId' });
  },
  validateUnique: async (data, excludeId) => {
    await ensureUniqueComposite({
      model: 'serviceItem',
      fields: {
        categoryId: data.categoryId,
        name: data.name
      },
      label: 'Service Item Name under this Category Group',
      excludeId
    });
  },
  recordName: (serviceItem) => serviceItem.name
});

baseService.importServiceItems = async (fileBuffer, actorUserId) => {
  if (!fileBuffer) {
    const error = new Error('No file provided for import');
    error.statusCode = 400;
    throw error;
  }

  const ExcelJS = require('exceljs');
  const { Readable } = require('stream');
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(fileBuffer);
  } catch (xlsxError) {
    try {
      const stream = Readable.from(fileBuffer);
      await workbook.csv.read(stream);
    } catch (csvError) {
      const error = new Error('Invalid file format. Please upload a valid .xlsx or .csv file.');
      error.statusCode = 400;
      throw error;
    }
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    const error = new Error('Worksheet not found in file');
    error.statusCode = 400;
    throw error;
  }

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const getVal = (idx) => {
        const cell = row.getCell(idx);
        if (!cell || cell.value === null || cell.value === undefined) return '';
        if (typeof cell.value === 'object' && cell.value.text) return String(cell.value.text).trim();
        if (typeof cell.value === 'object' && cell.value.result) return String(cell.value.result).trim();
        return String(cell.value).trim();
      };

      const name = getVal(1);
      const categoryName = getVal(2);
      const priceRaw = getVal(3);
      const estimatedTimeRaw = getVal(4);
      const descriptionRaw = getVal(5);
      const statusRaw = getVal(6);

      if (name && categoryName) {
        const parsedMinutes = estimatedTimeRaw ? parseInt(estimatedTimeRaw, 10) : null;
        const normStatus = String(statusRaw || '').trim().toLowerCase();
        const isActive = normStatus === 'inactive' || normStatus === 'false' || normStatus === '0' ? false : true;

        rows.push({
          rowNumber,
          name,
          categoryName,
          price: priceRaw || '0',
          estimatedMinutes: isNaN(parsedMinutes) ? null : parsedMinutes,
          description: descriptionRaw || null,
          isActive
        });
      }
    }
  });

  if (rows.length === 0) {
    const error = new Error('No valid service item rows found in Excel file');
    error.statusCode = 400;
    throw error;
  }

  const normalizeString = (str) => String(str || '').replace(/[\s\-_]/g, '').toLowerCase();

  let importedCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (const item of rows) {
    try {
      const rawCategoryNorm = normalizeString(item.categoryName);
      const allCategories = await prisma.serviceCategory.findMany({});

      let category = allCategories.find(c =>
        normalizeString(c.name) === rawCategoryNorm || normalizeString(c.slug) === rawCategoryNorm
      );

      // Only allow Mechanical and Body Shop categories
      if (category && !['mechanical', 'body-shop'].includes(category.slug)) {
        category = undefined;
      }

      if (!category) {
        skippedCount++;
        const validNames = allCategories
          .filter(c => c.isActive !== false && ['mechanical', 'body-shop'].includes(c.slug))
          .map(c => c.name)
          .join(', ');
        errors.push(`Row ${item.rowNumber}: Invalid Category Group "${item.categoryName}". Allowed: ${validNames || 'Mechanical, Body Shop'}. Skipped.`);
        continue;
      }

      const parsedPrice = parseFloat(item.price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        skippedCount++;
        errors.push(`Row ${item.rowNumber}: Invalid Base Price. Price must be greater than 0. Skipped.`);
        continue;
      }

      const rawItemNorm = normalizeString(item.name);
      const existingItems = await prisma.serviceItem.findMany({
        where: { categoryId: category.id }
      });

      const existing = existingItems.find(s =>
        normalizeString(s.name) === rawItemNorm || normalizeString(s.slug) === rawItemNorm
      );

      if (existing) {
        skippedCount++;
        errors.push(`Row ${item.rowNumber}: Service item "${item.name}" already exists under "${category.name}". Skipped.`);
        continue;
      }

      const itemSlug = await resolveSlug({ model: 'serviceItem', source: item.name });

      await prisma.serviceItem.create({
        data: {
          categoryId: category.id,
          name: item.name,
          slug: itemSlug,
          description: item.description,
          defaultPrice: item.price,
          estimatedMinutes: item.estimatedMinutes,
          isActive: item.isActive,
          createdById: actorUserId || null
        }
      });

      importedCount++;
    } catch (err) {
      skippedCount++;
      errors.push(`Row ${item.rowNumber}: Failed to import "${item.name}" - ${err.message}`);
    }
  }

  return {
    totalRows: rows.length,
    importedCount,
    skippedCount,
    errors
  };
};

module.exports = baseService;


