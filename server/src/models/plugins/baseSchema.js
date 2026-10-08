import mongoose from "mongoose";

export const baseSchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
};

export function applyBaseSchema(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  });

  schema.pre(/^find/, function excludeDeleted(next) {
    if (!this.getFilter().includeDeleted) {
      this.where({ isDeleted: false });
    }
    delete this.getFilter().includeDeleted;
    next();
  });

  schema.methods.softDelete = function softDelete(deletedBy) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = deletedBy;
    return this.save();
  };
}
