const prisma = require('../../config/db');
const { createAuditLog, buildChangeDetails } = require('../../common/utils/audit.util');
const { createStorageProvider } = require('../../providers/storage/storage.provider');
const storageProvider = createStorageProvider();

const listVehicles = async (query, user) => {
  const isExport = query.export === 'true';
  const page = isExport ? 1 : parseInt(query.page, 10) || 1;
  const limit = isExport ? 1000000 : parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const where = {};

  if (user && user.locationId) {
    where.locationId = Number(user.locationId);
  }

  if (query.search) {
    where.OR = [
      { registrationNo: { contains: query.search } },
      { customer: { fullName: { contains: query.search } } },
      { customer: { mobileNo: { contains: query.search } } }
    ];
  }

  if (query.status === 'active') where.isActive = true;
  if (query.status === 'inactive') where.isActive = false;

  const fromDateVal = query.fromDate || query.startDate;
  const toDateVal = query.toDate || query.endDate;

  if (fromDateVal) {
    const from = new Date(fromDateVal);
    if (!isNaN(from)) {
      where.createdAt = { ...where.createdAt, gte: from };
    }
  }
  if (toDateVal) {
    const to = new Date(toDateVal);
    if (!isNaN(to)) {
      to.setHours(23, 59, 59, 999);
      where.createdAt = { ...where.createdAt, lte: to };
    }
  }

  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      ...(isExport ? {} : { skip, take: limit }),
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { id: true, fullName: true, mobileNo: true }
        },
        brand: {
          select: { id: true, name: true }
        },
        location: {
          select: { id: true, locationName: true, locationCode: true }
        }
      }
    }),
    prisma.vehicle.count({ where })
  ]);

  return {
    vehicles,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const getVehicleById = async (idOrSlug, user) => {
  const isId = !isNaN(Number(idOrSlug));
  const where = isId ? { id: parseInt(idOrSlug, 10) } : { slug: idOrSlug };
  const vehicle = await prisma.vehicle.findUnique({
    where,
    include: {
      customer: {
        select: { id: true, fullName: true, mobileNo: true, emailId: true, address: true }
      },
      brand: {
        select: { id: true, name: true }
      },
      location: {
        select: { id: true, locationName: true, locationCode: true }
      }
    }
  });

  if (!vehicle) {
    throw new Error('Vehicle not found');
  }

  // Ensure location matches if user is restricted
  if (user && user.locationId && vehicle.locationId !== user.locationId) {
    throw new Error('Unauthorized to view this Vehicle');
  }

  // Fetch media files (images) associated with this vehicle, excluding customer signatures
  const mediaFiles = await prisma.mediaFile.findMany({
    where: {
      moduleName: 'Vehicle',
      moduleRecordId: vehicle.id,
      category: {
        notIn: ['SIGNATURE', 'signature', 'Signature']
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const vehiclePhotoFiles = mediaFiles.filter((m) => {
    const cat = String(m.category || '').toUpperCase();
    const fname = String(m.fileName || '').toLowerCase();
    const url = String(m.fileUrl || '').toLowerCase();
    return (
      cat !== 'SIGNATURE' &&
      !fname.includes('signature') &&
      !fname.includes('sign_') &&
      !fname.includes('sign-') &&
      !url.includes('signature')
    );
  });

  const signedMediaFiles = vehiclePhotoFiles.map(mediaFile => {
    let fileUrl = mediaFile.fileUrl;
    if (storageProvider.isConfigured && mediaFile.blobName) {
      try {
        fileUrl = storageProvider.generateSasUrl(mediaFile.blobName, 3600);
      } catch (e) {
        console.error('Error signing URL for vehicle image:', e);
      }
    }
    return {
      ...mediaFile,
      fileUrl
    };
  });

  return {
    ...vehicle,
    images: signedMediaFiles
  };
};

const updateVehicle = async (idOrSlug, data, user) => {
  const isId = !isNaN(Number(idOrSlug));
  const where = isId ? { id: parseInt(idOrSlug, 10) } : { slug: idOrSlug };

  // First, verify the vehicle exists and user is authorized
  const existingVehicle = await prisma.vehicle.findUnique({
    where,
    include: { customer: true }
  });

  if (!existingVehicle) {
    throw new Error('Vehicle not found');
  }

  if (user && user.locationId && existingVehicle.locationId !== user.locationId) {
    throw new Error('Unauthorized to update this Vehicle');
  }

  return await prisma.$transaction(async (tx) => {
    // Update vehicle and its customer
    const updatedVehicle = await tx.vehicle.update({
      where: { id: existingVehicle.id },
      data: {
        registrationNo: data.vehicleNumber,
        model: data.makeModel,
        variant: data.type,
        fuelType: data.fuelType,
        isActive: data.status ? data.status === 'ACTIVE' : undefined,
        modifiedBy: user ? { connect: { id: user.userId || user.id } } : undefined,
        customer: {
          update: {
            fullName: data.ownerName,
            mobileNo: data.mobile,
            modifiedBy: user ? { connect: { id: user.userId || user.id } } : undefined
          }
        }
      },
      include: {
        customer: true,
        brand: true,
        location: true
      }
    });

    const changedFields = buildChangeDetails(
      existingVehicle,
      updatedVehicle,
      ['registrationNo', 'model', 'variant', 'fuelType', 'isActive']
    );

    const customerChangedFields = buildChangeDetails(
      existingVehicle.customer || {},
      updatedVehicle.customer || {},
      ['fullName', 'mobileNo']
    );

    const allChanges = [
      ...changedFields,
      ...customerChangedFields.map(c => ({ ...c, fieldName: `customer.${c.fieldName}` }))
    ];

    if (allChanges.length > 0 && user) {
      await createAuditLog(tx, {
        tableName: 'vehicles',
        recordId: updatedVehicle.id,
        actionType: 'UPDATE',
        performedByUserId: user.userId || user.id,
        recordName: updatedVehicle.registrationNo,
        comments: 'Vehicle updated',
        details: allChanges,
        locationId: updatedVehicle.locationId
      });
    }

    return updatedVehicle;
  });
};

const getVehicleHistory = async (idOrSlug, query, user) => {
  const isId = !isNaN(Number(idOrSlug));
  const where = isId ? { id: parseInt(idOrSlug, 10) } : { slug: idOrSlug };

  const existingVehicle = await prisma.vehicle.findUnique({
    where,
    select: { id: true, registrationNo: true }
  });

  if (!existingVehicle) {
    throw new Error('Vehicle not found');
  }

  const jobCards = await prisma.jobCard.findMany({
    where: { vehicleId: existingVehicle.id },
    include: {
      customer: { select: { fullName: true } },
      currentStatus: { select: { statusCode: true } },
      services: {
        include: {
          serviceItem: { select: { name: true } }
        }
      },
      workAssignments: {
        include: {
          assignedUser: { select: { fullName: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const history = jobCards.map((job) => ({
    id: job.jobCardNo || job.id,
    slug: job.slug,
    date: job.createdAt.toISOString().split('T')[0],
    vehicleNumber: existingVehicle.registrationNo,
    customerName: job.customer?.fullName || 'N/A',
    services: job.services.map(s => s.serviceItem?.name).filter(Boolean),
    cost: Number(job.totalEstimate) || 0,
    status: job.currentStatus?.statusCode || 'PENDING',
    technician: job.workAssignments[0]?.assignedUser?.fullName || 'Unassigned',
    complaint: job.customerComplaint || 'No specific complaints',
    notes: job.additionalNotes || ''
  }));

  return history;
};

module.exports = {
  listVehicles,
  getVehicleById,
  updateVehicle,
  getVehicleHistory
};
