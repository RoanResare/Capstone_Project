import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

const products = [
  { id: 1, name: "Premium Dog Food", category: "food", image: "\uD83C\uDF56" },
  { id: 2, name: "Cat Nutrition Plus", category: "food", image: "\uD83D\uDC1F" },
  { id: 3, name: "Puppy Starter Pack", category: "food", image: "\uD83C\uDF57" },
  { id: 4, name: "Senior Pet Formula", category: "food", image: "\uD83E\uDD69" },
  { id: 5, name: "Organic Pet Treats", category: "food", image: "\uD83E\uDDB4" },
  { id: 6, name: "Kitten Milk Powder", category: "food", image: "\uD83E\uDD5B" },
  { id: 7, name: "Pet Shampoo", category: "grooming", image: "\uD83E\uDDF4" },
  { id: 8, name: "Nail Clippers", category: "grooming", image: "\u2702\uFE0F" },
  { id: 9, name: "Fur Brush Set", category: "grooming", image: "\uD83E\uDEAE" },
  { id: 10, name: "Ear Cleaning Solution", category: "grooming", image: "\uD83D\uDCA7" },
  { id: 11, name: "Paw Balm", category: "grooming", image: "\uD83E\uDDF4" },
  { id: 12, name: "Dental Care Kit", category: "grooming", image: "\uD83E\uDEA5" },
  { id: 13, name: "Vitamin Supplements", category: "health", image: "\uD83D\uDC8A" },
  { id: 14, name: "Flea & Tick Treatment", category: "health", image: "\uD83E\uDE7A" },
  { id: 15, name: "Joint Support Formula", category: "health", image: "\uD83D\uDC89" },
  { id: 16, name: "Probiotic Chews", category: "health", image: "\uD83C\uDF6C" },
  { id: 17, name: "First Aid Kit", category: "health", image: "\uD83E\uDE79" },
  { id: 18, name: "Calming Treats", category: "health", image: "\uD83D\uDE0C" },
];

const categories = [
  { id: "all", label: "All Products" },
  { id: "food", label: "Food & Nutrition" },
  { id: "grooming", label: "Grooming Products" },
  { id: "health", label: "Health & Wellness" },
];

export function Products() {
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredProducts =
    selectedCategory === "all"
      ? products
      : products.filter((product) => product.category === selectedCategory);

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F5F0E8] py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h1 className="text-5xl font-bold text-[#2D9B9B] mb-4">Pet Products</h1>
          <p className="text-xl text-gray-700">Quality products for your beloved pets</p>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-8">
          <motion.aside
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:w-64 flex-shrink-0"
          >
            <div className="bg-white rounded-2xl shadow-lg p-6 sticky top-24">
              <h2 className="text-xl font-bold text-gray-800 mb-6">Categories</h2>
              <div className="space-y-3">
                {categories.map((category) => {
                  const count =
                    category.id === "all"
                      ? products.length
                      : products.filter((product) => product.category === category.id).length;

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategory(category.id)}
                      className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                        selectedCategory === category.id
                          ? "bg-[#2D9B9B] text-white font-semibold shadow-md"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span>{category.label}</span>
                        <span
                          className={`text-sm ${
                            selectedCategory === category.id ? "text-white/80" : "text-gray-500"
                          }`}
                        >
                          ({count})
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.aside>

          <div className="flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedCategory}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {filteredProducts.map((product, index) => (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    whileHover={{ scale: 1.05, boxShadow: "0 10px 30px rgba(45, 155, 155, 0.2)" }}
                    className="bg-white rounded-2xl overflow-hidden shadow-lg cursor-pointer transition-all"
                  >
                    <div className="h-48 bg-gradient-to-br from-[#E8F5F5] to-white flex items-center justify-center">
                      <span className="text-7xl">{product.image}</span>
                    </div>

                    <div className="p-6 text-center">
                      <h3 className="text-lg font-semibold text-gray-800">{product.name}</h3>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>

            {filteredProducts.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <p className="text-xl text-gray-500">No products found in this category.</p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
