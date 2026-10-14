import assert from "node:assert/strict";
import { test } from "node:test";
import { GROOMING_SIZES, groomingQuote, groomingSizeForPet } from "../shared/groomingServices.mjs";

test("saved weight determines grooming size at each clinic cutoff", () => {
  for (const [weightKg, size] of [[1, "Small"], [6, "Small"], [6.1, "Medium"], [12, "Medium"], [12.1, "Large"], [21, "Large"], [21.1, "X-Large"]]) {
    assert.equal(groomingSizeForPet({ petType: "Dog", weightKg: String(weightKg) }), size);
  }
  assert.equal(groomingSizeForPet({ petType: "Dog", weightKg: "" }), "");
  assert.equal(groomingSizeForPet({ petType: "Cat", weightKg: "3" }), null);
});

test("all dog grooming rates match the supplied rate sheet", () => {
  const rates = { basic: [300, 350, 400, 450], "bath-blowdry": [250, 300, 350, 400], sanitary: [350, 400, 500, 550], "full-groom": [400, 500, 600, 700], "puppy-cut": [450, 550, 650, 750] };
  for (const [id, prices] of Object.entries(rates)) GROOMING_SIZES.forEach((size, index) => assert.equal(groomingQuote(id, size, "Dog").price, prices[index]));
  assert.equal(groomingQuote("feline-basic", null, "Cat").price, 500);
  assert.equal(groomingQuote("feline-sanitary", null, "Cat").price, 600);
  assert.throws(() => groomingQuote("feline-basic", "Small", "Dog"));
  assert.throws(() => groomingQuote("basic", "", "Dog"));
});
