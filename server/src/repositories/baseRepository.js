import { getPagination, paginationMeta } from "../utils/pagination.js";

export function createRepository(Model, defaultPopulate = []) {
  return {
    create(payload) {
      return Model.create(payload);
    },
    findById(id) {
      return Model.findById(id);
    },
    async list(filter = {}, query = {}) {
      const { page, limit, skip } = getPagination(query);
      const sort = query.sort ?? "-createdAt";
      const [items, total] = await Promise.all([
        Model.find(filter).populate(defaultPopulate).sort(sort).skip(skip).limit(limit),
        Model.countDocuments(filter)
      ]);
      return { items, meta: paginationMeta({ page, limit, total }) };
    },
    update(id, payload) {
      return Model.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
    },
    remove(id) {
      return Model.findByIdAndDelete(id);
    }
  };
}
