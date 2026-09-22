const { PrismaClient } = require('@prisma/client');
const { generateSlug } = require('../../src/common/utils/slug.util');

const SERVICE_CENTER = {
  serviceCenterCode: 'DVSOS-HQ',
  serviceCenterName: 'DVSOS Main Service Center',
  gstNumber: '33ABCDE1234F1Z5',
  contactPhone: '9876543210',
  contactEmail: 'service@dvsos.local',
  logoUrl: null,
  websiteUrl: null,
  tax: '10'
};

const LOCATION = {
  locationCode: 'DVSOS-CHN-001',
  locationName: 'DVSOS Chennai Workshop',
  locationType: 'WORKSHOP',
  address: 'Main Road, Chennai',
  city: 'Chennai',
  pincode: '600001',
  latitude: null,
  longitude: null,
  contactPhone: '9876543210',
  contactEmail: 'chennai@dvsos.local'
};

const seedServiceCentersLocations = async (prisma) => {
  await prisma.$transaction(async (tx) => {
    const locationSlug = generateSlug(LOCATION.locationName);
    const state = await tx.state.findUnique({
      where: { stateCode: 'TN' },
      select: { id: true }
    });

    if (!state) {
      throw new Error('Tamil Nadu state must be seeded before service center locations');
    }

    const district = await tx.district.findFirst({
      where: {
        stateId: state.id,
        districtName: 'Chennai'
      },
      select: { id: true }
    });

    if (!district) {
      throw new Error('Chennai district must be seeded before service center locations');
    }

    const serviceCenter = await tx.serviceCenter.upsert({
      where: { serviceCenterCode: SERVICE_CENTER.serviceCenterCode },
      update: {
        serviceCenterName: SERVICE_CENTER.serviceCenterName,
        gstNumber: SERVICE_CENTER.gstNumber,
        contactPhone: SERVICE_CENTER.contactPhone,
        contactEmail: SERVICE_CENTER.contactEmail,
        logoUrl: SERVICE_CENTER.logoUrl,
        websiteUrl: SERVICE_CENTER.websiteUrl,
        tax: SERVICE_CENTER.tax,
        isActive: true
      },
      create: {
        ...SERVICE_CENTER,
        isActive: true
      }
    });

    await tx.location.upsert({
      where: { locationCode: LOCATION.locationCode },
      update: {
        serviceCenterId: serviceCenter.id,
        stateId: state.id,
        districtId: district.id,
        locationHeadUserId: null,
        locationName: LOCATION.locationName,
        slug: locationSlug,
        locationType: LOCATION.locationType,
        address: LOCATION.address,
        city: LOCATION.city,
        pincode: LOCATION.pincode,
        latitude: LOCATION.latitude,
        longitude: LOCATION.longitude,
        contactPhone: LOCATION.contactPhone,
        contactEmail: LOCATION.contactEmail,
        isActive: true
      },
      create: {
        serviceCenterId: serviceCenter.id,
        stateId: state.id,
        districtId: district.id,
        locationHeadUserId: null,
        slug: locationSlug,
        ...LOCATION,
        isActive: true
      }
    });

    console.log('Service center and location seeded');
  });
};

const run = async () => {
  const prisma = new PrismaClient();

  try {
    await seedServiceCentersLocations(prisma);
  } catch (error) {
    console.error('Service center and location seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  SERVICE_CENTER,
  LOCATION,
  seedServiceCentersLocations
};
