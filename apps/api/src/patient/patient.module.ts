import { Module } from '@nestjs/common';
import { PatientDoctorService } from './patient-doctor.service';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';

@Module({
  controllers: [PatientController],
  providers: [PatientService, PatientDoctorService],
  exports: [PatientService, PatientDoctorService],
})
export class PatientModule {}
